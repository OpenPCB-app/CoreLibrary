#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ID_REGEX, REPO_ROOT, SEMVER_REGEX, sha256File } from "./lib";

const LICENSE = "CC-BY-SA-4.0+KiCad-Libraries-Exception";
const TOOL = "CoreLibrary tools/backfill-step-models.ts";
const DEFAULT_KICAD_ROOT = path.resolve(REPO_ROOT, "..", "kicad-libs");

interface BackfillEntry {
  footprintId: string;
  footprintPath: string;
  modelId: string;
  modelName: string;
  stepSource: string;
  stepOutput: string;
}

interface BackfillManifest {
  version: string;
  entries: BackfillEntry[];
}

interface Args {
  manifest: string;
  kicadRoot: string;
  out: string;
  dryRun: boolean;
  strict: boolean;
  allowOverwrite: boolean;
  convertedAt: string;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const allowedValues = new Set(["manifest", "kicad-root", "out", "converted-at"]);
  const allowedFlags = new Set(["dry-run", "strict", "allow-overwrite"]);
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`Invalid argument: ${arg}`);
    if (arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      if (!key || !allowedValues.has(key)) throw new Error(`Unknown argument: --${key}`);
      values.set(key, rest.join("="));
    } else {
      const flag = arg.slice(2);
      if (!allowedFlags.has(flag)) throw new Error(`Unknown flag: --${flag}`);
      flags.add(flag);
    }
  }

  const manifest = values.get("manifest");
  if (!manifest) throw new Error("--manifest is required");
  const convertedAt = values.get("converted-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(convertedAt))) throw new Error("--converted-at must be an ISO date-time");
  return {
    manifest: path.resolve(manifest),
    kicadRoot: path.resolve(values.get("kicad-root") ?? DEFAULT_KICAD_ROOT),
    out: path.resolve(values.get("out") ?? REPO_ROOT),
    dryRun: flags.has("dry-run"),
    strict: flags.has("strict"),
    allowOverwrite: flags.has("allow-overwrite"),
    convertedAt,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${pathName} must be a non-empty string`);
  return value;
}

function requireId(value: unknown, pathName: string): string {
  const id = requireString(value, pathName);
  if (!ID_REGEX.test(id)) throw new Error(`${pathName} must be a valid OpenPCB id`);
  return id;
}

function requirePath(value: unknown, pathName: string, suffix: string): string {
  const source = requireString(value, pathName);
  if (path.isAbsolute(source)) throw new Error(`${pathName} must be repository-relative`);
  if (!source.endsWith(suffix)) throw new Error(`${pathName} must end with ${suffix}`);
  return source;
}

function readEntry(value: unknown, pathName: string): BackfillEntry {
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  return {
    footprintId: requireId(value.footprintId, `${pathName}.footprintId`),
    footprintPath: requirePath(value.footprintPath, `${pathName}.footprintPath`, ".fp.json"),
    modelId: requireId(value.modelId, `${pathName}.modelId`),
    modelName: requireString(value.modelName, `${pathName}.modelName`),
    stepSource: requirePath(value.stepSource, `${pathName}.stepSource`, ".step"),
    stepOutput: requirePath(value.stepOutput, `${pathName}.stepOutput`, ".step"),
  };
}

async function loadManifest(file: string): Promise<BackfillManifest> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("manifest must be an object");
  const version = requireString(raw.version, "manifest.version");
  if (!SEMVER_REGEX.test(version)) throw new Error("manifest.version must be semver");
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) throw new Error("manifest.entries must be a non-empty array");
  return { version, entries: raw.entries.map((entry, index) => readEntry(entry, `manifest.entries[${index}]`)) };
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function uuidFromSeed(seed: string): string {
  const hex = sha256(seed);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

function sourcePath(kicadRoot: string, source: string): string {
  return path.join(kicadRoot, source);
}

function modelPathFor(out: string, stepOutput: string): string {
  return path.join(out, stepOutput.replace(/\.step$/, ".model.json"));
}

function provenance(source: string, item: string, hash: string, convertedAt: string) {
  const parent = path.basename(path.dirname(source)).replace(/\.3dshapes$/, "");
  return {
    source: "kicad-derived",
    license: LICENSE,
    attribution: ["Derived from KiCad official libraries."],
    sourceFormat: "step",
    sourceFileName: path.basename(source),
    sourceLibrary: parent,
    sourceItemName: item,
    sourceHash: hash,
    upstreamUrl: "https://gitlab.com/kicad/libraries",
    convertedAt,
    conversionTool: TOOL,
  };
}

function validateManifest(manifest: BackfillManifest): void {
  const footprintIds = new Set<string>();
  const modelIds = new Set<string>();
  const stepOutputs = new Set<string>();
  for (const entry of manifest.entries) {
    if (footprintIds.has(entry.footprintId)) throw new Error(`duplicate footprintId: ${entry.footprintId}`);
    if (modelIds.has(entry.modelId)) throw new Error(`duplicate modelId: ${entry.modelId}`);
    if (stepOutputs.has(entry.stepOutput)) throw new Error(`duplicate stepOutput: ${entry.stepOutput}`);
    if (!entry.stepOutput.startsWith("3d/")) throw new Error(`${entry.modelId} stepOutput must stay under 3d/`);
    footprintIds.add(entry.footprintId);
    modelIds.add(entry.modelId);
    stepOutputs.add(entry.stepOutput);
  }
}

function validateOutputPath(file: string, allowOverwrite: boolean, dryRun: boolean): void {
  if (!allowOverwrite && !dryRun && existsSync(file)) throw new Error(`output path already exists: ${file} (pass --allow-overwrite to replace)`);
}

async function readFootprint(file: string, expectedId: string): Promise<Record<string, unknown>> {
  const data = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!isObject(data)) throw new Error(`${file} must be an object`);
  if (data.id !== expectedId) throw new Error(`${file} id mismatch: expected ${expectedId}, got ${String(data.id)}`);
  return data;
}

async function writeJson(file: string, data: unknown, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const manifest = await loadManifest(args.manifest);
  validateManifest(manifest);

  for (const entry of manifest.entries) {
    const footprintPath = path.join(args.out, entry.footprintPath);
    if (!existsSync(footprintPath)) throw new Error(`missing footprint: ${footprintPath}`);
    const stepSource = sourcePath(args.kicadRoot, entry.stepSource);
    if (!existsSync(stepSource)) throw new Error(`missing STEP source: ${stepSource}`);
    const stepOutput = path.join(args.out, entry.stepOutput);
    const modelPath = modelPathFor(args.out, entry.stepOutput);
    validateOutputPath(stepOutput, args.allowOverwrite, args.dryRun);
    validateOutputPath(modelPath, args.allowOverwrite, args.dryRun);

    const footprint = await readFootprint(footprintPath, entry.footprintId);
    if (args.strict) {
      const footprintName = typeof footprint.name === "string" ? footprint.name : "";
      const sourceBase = path.basename(entry.stepSource, ".step");
      if (footprintName !== sourceBase) throw new Error(`strict mode footprint/model name mismatch for ${entry.footprintId}: ${footprintName} !== ${sourceBase}`);
    }

    const hash = sha256File(stepSource);
    footprint.models3d = [entry.modelId];
    const model = {
      id: entry.modelId,
      uuid: uuidFromSeed(entry.modelId),
      version: manifest.version,
      name: entry.modelName,
      formats: { step: { path: entry.stepOutput, sha256: hash } },
      provenance: provenance(stepSource, path.basename(stepSource), hash, args.convertedAt),
      offsetMm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    };

    await writeJson(footprintPath, footprint, args.dryRun);
    await writeJson(modelPath, model, args.dryRun);
    if (!args.dryRun) {
      await mkdir(path.dirname(stepOutput), { recursive: true });
      await copyFile(stepSource, stepOutput);
    }
  }

  const action = args.dryRun ? "validated" : "wrote";
  const mode = args.strict ? " strict" : "";
  console.log(`[backfill-step-models]${mode} ${action} ${manifest.entries.length} STEP model backfills`);
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backfill-step-models] ${message}`);
  process.exit(1);
});
