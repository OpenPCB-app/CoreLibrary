#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, walkFiles } from "./lib";

type Vec3 = { x: number; y: number; z: number };

interface FootprintSource {
  id: string;
  name: string;
  models3d?: string[];
  normalized?: {
    preview?: {
      bounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
      pads?: Array<{ centerMm?: { x: number; y: number }; widthMm?: number; heightMm?: number }>;
    };
  };
}

interface ModelSource {
  id: string;
  name: string;
  formats: { step?: { path: string; sha256: string }; glb?: { path: string; sha256: string } };
  offsetMm?: Vec3;
  rotationDeg?: Vec3;
  scaleMm?: Vec3;
}

interface AuditFinding {
  severity: "error" | "warning" | "review";
  message: string;
}

interface AuditRow {
  footprintId: string;
  footprintName: string;
  modelId: string | null;
  modelName: string | null;
  footprintBoundsMm: { minX: number; minY: number; maxX: number; maxY: number } | null;
  transform: { offsetMm: Vec3; rotationDeg: Vec3; scaleMm: Vec3 } | null;
  findings: AuditFinding[];
}

const args = new Set(process.argv.slice(2));
const releaseMode = args.has("--release");
const outDir = path.join(REPO_ROOT, "dist", "audit-3d-placement");

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isIdentityScale(v: Vec3): boolean {
  return v.x === 1 && v.y === 1 && v.z === 1;
}

function isZeroVec(v: Vec3): boolean {
  return v.x === 0 && v.y === 0 && v.z === 0;
}

function padBounds(fp: FootprintSource): AuditRow["footprintBoundsMm"] {
  const explicit = fp.normalized?.preview?.bounds;
  if (explicit) return explicit;
  const pads = fp.normalized?.preview?.pads ?? [];
  if (pads.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pad of pads) {
    if (!pad.centerMm || !pad.widthMm || !pad.heightMm) continue;
    minX = Math.min(minX, pad.centerMm.x - pad.widthMm / 2);
    maxX = Math.max(maxX, pad.centerMm.x + pad.widthMm / 2);
    minY = Math.min(minY, pad.centerMm.y - pad.heightMm / 2);
    maxY = Math.max(maxY, pad.centerMm.y + pad.heightMm / 2);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function transformFor(model: ModelSource): AuditRow["transform"] {
  return {
    offsetMm: model.offsetMm ?? { x: 0, y: 0, z: 0 },
    rotationDeg: model.rotationDeg ?? { x: 0, y: 0, z: 0 },
    scaleMm: model.scaleMm ?? { x: 1, y: 1, z: 1 },
  };
}

function classify(row: AuditRow): void {
  if (!row.modelId || !row.transform) return;
  const { offsetMm, rotationDeg, scaleMm } = row.transform;
  for (const [label, vec] of Object.entries({ offsetMm, rotationDeg, scaleMm })) {
    if (!isFiniteVec3(vec)) row.findings.push({ severity: "error", message: `${label} contains non-finite values` });
  }
  if (scaleMm.x === 0 || scaleMm.y === 0 || scaleMm.z === 0) {
    row.findings.push({ severity: "error", message: "scaleMm contains zero axis" });
  }
  const lower = `${row.footprintId} ${row.footprintName}`.toLowerCase();
  if (lower.includes("connector") || lower.includes("led")) {
    row.findings.push({ severity: "review", message: "connector/LED 3D orientation requires manual visual review" });
  }
  if (!isZeroVec(rotationDeg) || !isIdentityScale(scaleMm) || !isZeroVec(offsetMm)) {
    row.findings.push({ severity: "warning", message: "non-identity transform will be baked into generated GLB" });
  }
  const bounds = row.footprintBoundsMm;
  if (!bounds) row.findings.push({ severity: "warning", message: "footprint has no computable preview bounds" });
  else if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    row.findings.push({ severity: "error", message: "footprint bounds are invalid" });
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const modelsById = new Map<string, ModelSource>();
for (const filePath of walkFiles(path.join(REPO_ROOT, "3d"), ".model.json")) {
  const model = readJson<ModelSource>(filePath);
  modelsById.set(model.id, model);
}

const rows: AuditRow[] = [];
for (const filePath of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
  const footprint = readJson<FootprintSource>(filePath);
  const modelIds = footprint.models3d ?? [];
  if (modelIds.length === 0) continue;
  for (const modelId of modelIds) {
    const model = modelsById.get(modelId) ?? null;
    const findings: AuditFinding[] = [];
    if (!model) findings.push({ severity: "error", message: `missing model ${modelId}` });
    else {
      const stepPath = model.formats.step?.path;
      if (!stepPath || !existsSync(path.join(REPO_ROOT, stepPath))) {
        findings.push({ severity: "error", message: "missing STEP source asset" });
      }
    }
    const row: AuditRow = {
      footprintId: footprint.id,
      footprintName: footprint.name,
      modelId,
      modelName: model?.name ?? null,
      footprintBoundsMm: padBounds(footprint),
      transform: model ? transformFor(model) : null,
      findings,
    };
    classify(row);
    rows.push(row);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  releaseMode,
  counts: {
    rows: rows.length,
    errors: rows.flatMap((row) => row.findings).filter((f) => f.severity === "error").length,
    warnings: rows.flatMap((row) => row.findings).filter((f) => f.severity === "warning").length,
    reviews: rows.flatMap((row) => row.findings).filter((f) => f.severity === "review").length,
  },
  rows,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  path.join(outDir, "report.html"),
  `<!doctype html><meta charset="utf-8"><title>OpenPCB 3D placement audit</title><style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.35rem;text-align:left;vertical-align:top}.error{color:#b91c1c}.warning{color:#a16207}.review{color:#4338ca}</style><h1>3D placement audit</h1><p>${summary.counts.rows} rows, ${summary.counts.errors} errors, ${summary.counts.warnings} warnings, ${summary.counts.reviews} manual reviews.</p><table><thead><tr><th>Footprint</th><th>Model</th><th>Transform</th><th>Findings</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.footprintName)}<br><small>${escapeHtml(row.footprintId)}</small></td><td>${escapeHtml(row.modelName ?? "missing")}<br><small>${escapeHtml(row.modelId ?? "")}</small></td><td><pre>${escapeHtml(JSON.stringify(row.transform, null, 2))}</pre></td><td>${row.findings.map((f) => `<div class="${f.severity}">${f.severity}: ${escapeHtml(f.message)}</div>`).join("")}</td></tr>`).join("")}</tbody></table>`,
);

console.log(`[audit-3d-placement] wrote ${path.join(outDir, "report.json")}`);
if (releaseMode && summary.counts.errors > 0) process.exit(1);
