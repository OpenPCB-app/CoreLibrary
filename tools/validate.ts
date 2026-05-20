#!/usr/bin/env bun
import path from "node:path";
import { existsSync } from "node:fs";
import {
  REPO_ROOT,
  ID_REGEX,
  loadJson,
  loadSchema,
  makeAjv,
  sha256File,
  walkFiles,
} from "./lib";

interface Issue {
  file: string;
  message: string;
}

interface Provenance {
  source?: string;
  license?: string;
  attribution?: string[];
  sourceFormat?: string;
  sourceFileName?: string;
  sourceLibrary?: string;
  sourceItemName?: string;
  sourceHash?: string;
  upstreamUrl?: string;
  upstreamCommit?: string;
  convertedAt?: string;
  conversionTool?: string;
}

interface PinMapEntry {
  pinNumber: string;
  padNumber: string;
  pinName?: string;
}

interface SymbolSource {
  id: string;
  uuid: string;
  provenance: Provenance;
  normalized?: {
    pins?: Array<{ number?: string }>;
    preview?: { pins?: Array<{ number?: string }> };
  };
}

interface FootprintSource {
  id: string;
  uuid: string;
  provenance: Provenance;
  models3d?: string[];
  normalized?: {
    preview?: { pads?: Array<{ number?: string }> };
  };
}

const issues: Issue[] = [];
const warnings: Issue[] = [];
const LIBRARY_ROOT = process.env.CORELIB_ROOT
  ? path.resolve(process.env.CORELIB_ROOT)
  : REPO_ROOT;

const REQUIRED_KICAD_PROVENANCE_FIELDS = [
  "source",
  "license",
  "attribution",
  "sourceFormat",
  "sourceFileName",
  "sourceLibrary",
  "sourceItemName",
  "sourceHash",
  "upstreamUrl",
  "convertedAt",
  "conversionTool",
] as const;

const KICAD_LICENSE = "CC-BY-SA-4.0+KiCad-Libraries-Exception";
const INCOMPATIBLE_KICAD_LICENSES = new Set(["CC-BY-4.0", "CC0-1.0"]);

function fail(file: string, message: string) {
  issues.push({ file: displayPath(file), message });
}

function warn(file: string, message: string) {
  warnings.push({ file: displayPath(file), message });
}

function displayPath(absPath: string): string {
  return path.relative(LIBRARY_ROOT, absPath).split(path.sep).join("/");
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return true;
  return value !== undefined && value !== null;
}

function checkProvenance(file: string, provenance: Provenance) {
  if (provenance.source !== "kicad-derived") return;

  for (const field of REQUIRED_KICAD_PROVENANCE_FIELDS) {
    if (!hasValue(provenance[field])) fail(file, `missing KiCad provenance field: ${field}`);
  }

  if (provenance.license !== KICAD_LICENSE) {
    const reason = INCOMPATIBLE_KICAD_LICENSES.has(provenance.license ?? "")
      ? "weak conflicting license"
      : "non-CC-BY-SA compatible license";
    fail(file, `KiCad-derived asset uses ${reason}: ${provenance.license ?? "<missing>"}`);
  }

  if (Array.isArray(provenance.attribution) && provenance.attribution.length === 0) {
    warn(file, "KiCad-derived asset has empty attribution");
  }
}

const ajv = makeAjv();
const validateSymbol = ajv.compile(loadSchema("symbol"));
const validateFootprint = ajv.compile(loadSchema("footprint"));
const validateComponent = ajv.compile(loadSchema("component"));
const validateModel3d = ajv.compile(loadSchema("model3d"));

const symbolsRoot = path.join(LIBRARY_ROOT, "symbols");
const footprintsRoot = path.join(LIBRARY_ROOT, "footprints");
const componentsRoot = path.join(LIBRARY_ROOT, "components");
const modelsRoot = path.join(LIBRARY_ROOT, "3d");

const uuidIndex = new Map<string, string>();
const idIndex = new Map<string, string>();

function checkUniqueness(file: string, id: string, uuid: string) {
  if (!ID_REGEX.test(id)) fail(file, `invalid id: ${id}`);
  const idHit = idIndex.get(id);
  if (idHit) fail(file, `duplicate id ${id} (also in ${idHit})`);
  else idIndex.set(id, displayPath(file));
  const uuidHit = uuidIndex.get(uuid);
  if (uuidHit) fail(file, `duplicate uuid ${uuid} (also in ${uuidHit})`);
  else uuidIndex.set(uuid, displayPath(file));
}

function stringSet(values: Array<string | undefined> | undefined): Set<string> {
  return new Set((values ?? []).filter((value): value is string => typeof value === "string" && value.trim().length > 0));
}

function symbolPinNumbers(data: SymbolSource): Set<string> {
  const normalizedPins = stringSet(data.normalized?.pins?.map((pin) => pin.number));
  if (normalizedPins.size > 0) return normalizedPins;
  return stringSet(data.normalized?.preview?.pins?.map((pin) => pin.number));
}

function footprintPadNumbers(data: FootprintSource): Set<string> {
  return stringSet(data.normalized?.preview?.pads?.map((pad) => pad.number));
}

function setDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

// --- symbols ---
const symbolIds = new Set<string>();
const symbolPinsById = new Map<string, Set<string>>();
for (const file of walkFiles(symbolsRoot, ".symbol.json")) {
  const data = loadJson<SymbolSource>(file);
  if (!validateSymbol(data)) {
    for (const err of validateSymbol.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkProvenance(file, data.provenance);
  checkUniqueness(file, data.id, data.uuid);
  symbolIds.add(data.id);
  symbolPinsById.set(data.id, symbolPinNumbers(data));
}

// --- footprints ---
const footprintIds = new Set<string>();
const footprintPadsById = new Map<string, Set<string>>();
const footprintModelRefs: Array<{ file: string; footprintId: string; modelIds: string[] }> = [];
for (const file of walkFiles(footprintsRoot, ".fp.json")) {
  const data = loadJson<FootprintSource>(file);
  if (!validateFootprint(data)) {
    for (const err of validateFootprint.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkProvenance(file, data.provenance);
  checkUniqueness(file, data.id, data.uuid);
  footprintIds.add(data.id);
  footprintPadsById.set(data.id, footprintPadNumbers(data));
  footprintModelRefs.push({ file, footprintId: data.id, modelIds: data.models3d ?? [] });
}

// --- models3d ---
const modelIds = new Set<string>();
for (const file of walkFiles(modelsRoot, ".model.json")) {
  const data = loadJson<{
    id: string;
    uuid: string;
    provenance: Provenance;
    formats: Record<string, { path: string; sha256: string }>;
  }>(file);
  if (!validateModel3d(data)) {
    for (const err of validateModel3d.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkProvenance(file, data.provenance);
  checkUniqueness(file, data.id, data.uuid);
  modelIds.add(data.id);
  for (const [fmt, info] of Object.entries(data.formats)) {
    const abs = path.join(LIBRARY_ROOT, info.path);
    if (!existsSync(abs)) {
      fail(file, `${fmt} asset missing: ${info.path}`);
    } else if (sha256File(abs) !== info.sha256) {
      fail(file, `${fmt} sha256 mismatch: ${info.path}`);
    }
  }
}

for (const ref of footprintModelRefs) {
  for (const modelId of ref.modelIds) {
    if (!modelIds.has(modelId))
      fail(ref.file, `unknown 3d model ref on ${ref.footprintId}: ${modelId}`);
  }
}

// --- components ---
for (const file of walkFiles(componentsRoot, ".component.json")) {
  const data = loadJson<{
    id: string;
    uuid: string;
    symbol: string;
    defaultFootprint: string;
    provenance: Provenance;
    footprints: Array<{
      footprint: string;
      pinMap?: PinMapEntry[];
    }>;
  }>(file);
  if (!validateComponent(data)) {
    for (const err of validateComponent.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkProvenance(file, data.provenance);
  checkUniqueness(file, data.id, data.uuid);
  const symbolPins = symbolPinsById.get(data.symbol);
  if (!symbolIds.has(data.symbol))
    fail(file, `unknown symbol ref: ${data.symbol}`);
  const variantFps = new Set(data.footprints.map((v) => v.footprint));
  if (!variantFps.has(data.defaultFootprint))
    fail(file, `defaultFootprint ${data.defaultFootprint} not in footprints[]`);
  for (const v of data.footprints) {
    const footprintPads = footprintPadsById.get(v.footprint);
    if (!footprintIds.has(v.footprint))
      fail(file, `unknown footprint ref: ${v.footprint}`);
    if (!symbolPins || !footprintPads) continue;

    const pinMap = v.pinMap ?? [];
    if (pinMap.length === 0 && symbolPins.size > 0) {
      fail(file, `missing pinMap for footprint ${v.footprint}`);
      continue;
    }

    const mappedPins = new Set<string>();
    const mappedPads = new Set<string>();
    for (const entry of pinMap) {
      mappedPins.add(entry.pinNumber);
      mappedPads.add(entry.padNumber);
      if (!symbolPins.has(entry.pinNumber))
        fail(file, `pinMap references unknown symbol pin ${entry.pinNumber} for footprint ${v.footprint}`);
      if (!footprintPads.has(entry.padNumber))
        fail(file, `pinMap references unknown footprint pad ${entry.padNumber} for footprint ${v.footprint}`);
    }

    const unmappedPins = setDifference(symbolPins, mappedPins);
    if (unmappedPins.length > 0)
      fail(file, `pinMap for footprint ${v.footprint} does not map symbol pin(s): ${unmappedPins.join(", ")}`);

    const unmappedPads = setDifference(footprintPads, mappedPads);
    if (unmappedPads.length > 0)
      warn(file, `pinMap for footprint ${v.footprint} does not map footprint pad(s): ${unmappedPads.join(", ")}`);
  }
}

if (issues.length === 0) {
  for (const warning of warnings) console.warn(`  ${warning.file}: ${warning.message}`);
  console.log(
    `[validate] OK — ${symbolIds.size} symbols, ${footprintIds.size} footprints, ${modelIds.size} 3d models, ${idIndex.size - symbolIds.size - footprintIds.size - modelIds.size} components`,
  );
  process.exit(0);
}

console.error(`[validate] ${issues.length} issue(s):`);
for (const issue of issues) console.error(`  ${issue.file}: ${issue.message}`);
process.exit(1);
