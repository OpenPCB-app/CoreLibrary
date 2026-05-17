#!/usr/bin/env bun
import path from "node:path";
import { existsSync } from "node:fs";
import {
  REPO_ROOT,
  ID_REGEX,
  loadJson,
  loadSchema,
  makeAjv,
  relPath,
  sha256File,
  walkFiles,
} from "./lib";

interface Issue {
  file: string;
  message: string;
}

const issues: Issue[] = [];

function fail(file: string, message: string) {
  issues.push({ file: relPath(file), message });
}

const ajv = makeAjv();
const validateSymbol = ajv.compile(loadSchema("symbol"));
const validateFootprint = ajv.compile(loadSchema("footprint"));
const validateComponent = ajv.compile(loadSchema("component"));
const validateModel3d = ajv.compile(loadSchema("model3d"));

const symbolsRoot = path.join(REPO_ROOT, "symbols");
const footprintsRoot = path.join(REPO_ROOT, "footprints");
const componentsRoot = path.join(REPO_ROOT, "components");
const modelsRoot = path.join(REPO_ROOT, "3d");

const uuidIndex = new Map<string, string>();
const idIndex = new Map<string, string>();

function checkUniqueness(file: string, id: string, uuid: string) {
  if (!ID_REGEX.test(id)) fail(file, `invalid id: ${id}`);
  const idHit = idIndex.get(id);
  if (idHit) fail(file, `duplicate id ${id} (also in ${idHit})`);
  else idIndex.set(id, relPath(file));
  const uuidHit = uuidIndex.get(uuid);
  if (uuidHit) fail(file, `duplicate uuid ${uuid} (also in ${uuidHit})`);
  else uuidIndex.set(uuid, relPath(file));
}

// --- symbols ---
const symbolIds = new Set<string>();
for (const file of walkFiles(symbolsRoot, ".symbol.json")) {
  const data = loadJson<{ id: string; uuid: string }>(file);
  if (!validateSymbol(data)) {
    for (const err of validateSymbol.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkUniqueness(file, data.id, data.uuid);
  symbolIds.add(data.id);
}

// --- footprints ---
const footprintIds = new Set<string>();
for (const file of walkFiles(footprintsRoot, ".fp.json")) {
  const data = loadJson<{ id: string; uuid: string; pads: unknown[] }>(file);
  if (!validateFootprint(data)) {
    for (const err of validateFootprint.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkUniqueness(file, data.id, data.uuid);
  footprintIds.add(data.id);
}

// --- models3d ---
const modelIds = new Set<string>();
for (const file of walkFiles(modelsRoot, ".model.json")) {
  const data = loadJson<{
    id: string;
    uuid: string;
    formats: Record<string, { path: string; sha256: string }>;
  }>(file);
  if (!validateModel3d(data)) {
    for (const err of validateModel3d.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkUniqueness(file, data.id, data.uuid);
  modelIds.add(data.id);
  for (const [fmt, info] of Object.entries(data.formats)) {
    const abs = path.join(REPO_ROOT, info.path);
    if (!existsSync(abs)) {
      fail(file, `${fmt} asset missing: ${info.path}`);
    } else if (sha256File(abs) !== info.sha256) {
      fail(file, `${fmt} sha256 mismatch: ${info.path}`);
    }
  }
}

// --- components ---
for (const file of walkFiles(componentsRoot, ".component.json")) {
  const data = loadJson<{
    id: string;
    uuid: string;
    symbol: string;
    defaultFootprint: string;
    footprints: Array<{
      footprint: string;
      pinMap?: Array<{ pinNumber: string }>;
    }>;
  }>(file);
  if (!validateComponent(data)) {
    for (const err of validateComponent.errors ?? [])
      fail(file, `${err.instancePath} ${err.message}`);
    continue;
  }
  checkUniqueness(file, data.id, data.uuid);
  if (!symbolIds.has(data.symbol))
    fail(file, `unknown symbol ref: ${data.symbol}`);
  const variantFps = new Set(data.footprints.map((v) => v.footprint));
  if (!variantFps.has(data.defaultFootprint))
    fail(file, `defaultFootprint ${data.defaultFootprint} not in footprints[]`);
  for (const v of data.footprints) {
    if (!footprintIds.has(v.footprint))
      fail(file, `unknown footprint ref: ${v.footprint}`);
  }
}

if (issues.length === 0) {
  console.log(
    `[validate] OK — ${symbolIds.size} symbols, ${footprintIds.size} footprints, ${modelIds.size} 3d models, ${idIndex.size - symbolIds.size - footprintIds.size - modelIds.size} components`,
  );
  process.exit(0);
}

console.error(`[validate] ${issues.length} issue(s):`);
for (const issue of issues) console.error(`  ${issue.file}: ${issue.message}`);
process.exit(1);
