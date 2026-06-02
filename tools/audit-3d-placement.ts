#!/usr/bin/env bun
/**
 * 3D placement orientation gate + report.
 *
 * For every footprint that references a 3D model, bake the model's GLB exactly
 * as `pack` does, measure its bounding box in the scene frame (Z-up, mm, origin
 * = footprint origin) and run the geometric orientation gate
 * (`orientation-gate.ts`). Catches the real failure modes that the old
 * metadata-only audit could not: bodies rotated below the board, parts lying on
 * their side, models off-centre from their pads (wrong offset / mirror /
 * in-plane rotation), and gross scale errors.
 *
 *   bun tools/audit-3d-placement.ts            # write report, never fails
 *   bun tools/audit-3d-placement.ts --release  # exit 1 on any error finding
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";
import {
  convertModel,
  evaluatePlacement,
  type FootprintSidecar,
  type ModelSidecar,
} from "./placement-eval";
import type { ModelBounds } from "./glb-bounds";
import type { Finding, Severity } from "./orientation-gate";

const args = new Set(process.argv.slice(2));
const releaseMode = args.has("--release");
const outDir = path.join(REPO_ROOT, "dist", "audit-3d-placement");

interface AuditRow {
  footprintId: string;
  footprintName: string;
  mountType: string;
  modelId: string | null;
  bounds: ModelBounds | null;
  verdict: Severity | "ok";
  findings: Finding[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmtBounds(b: ModelBounds | null): string {
  if (!b) return "—";
  const f = (n: number): string => n.toFixed(2);
  return `min(${f(b.min.x)}, ${f(b.min.y)}, ${f(b.min.z)})  max(${f(b.max.x)}, ${f(b.max.y)}, ${f(b.max.z)})  size(${f(b.size.x)}, ${f(b.size.y)}, ${f(b.size.z)})`;
}

const models = new Map<string, ModelSidecar>();
for (const file of walkFiles(path.join(REPO_ROOT, "3d"), ".model.json")) {
  const m = loadJson<ModelSidecar>(file);
  models.set(m.id, m);
}

const rows: AuditRow[] = [];
for (const file of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
  const fp = loadJson<FootprintSidecar>(file);
  const modelIds = fp.models3d ?? [];
  if (modelIds.length === 0) continue;
  for (const modelId of modelIds) {
    const model = models.get(modelId) ?? null;
    const findings: Finding[] = [];
    let bounds: ModelBounds | null = null;
    let verdict: Severity | "ok" = "ok";

    if (!model) {
      findings.push({
        check: "ref",
        severity: "error",
        message: `missing model ${modelId}`,
      });
      verdict = "error";
    } else if (
      !model.formats.step ||
      !existsSync(path.join(REPO_ROOT, model.formats.step.path))
    ) {
      findings.push({
        check: "ref",
        severity: "error",
        message: "missing STEP source asset",
      });
      verdict = "error";
    } else {
      try {
        const converted = await convertModel(model);
        bounds = converted.bounds;
        const placement = evaluatePlacement(fp, converted.bounds);
        findings.push(...placement.findings);
        verdict = placement.verdict;
      } catch (error) {
        findings.push({
          check: "convert",
          severity: "error",
          message: (error as Error).message,
        });
        verdict = "error";
      }
    }

    rows.push({
      footprintId: fp.id,
      footprintName: fp.name ?? fp.id,
      mountType: fp.mountType ?? "other",
      modelId,
      bounds,
      verdict,
      findings,
    });
    const icon =
      verdict === "error"
        ? "✗"
        : verdict === "warning"
          ? "!"
          : verdict === "review"
            ? "?"
            : "✓";
    console.log(`[audit-3d] ${icon} ${verdict.padEnd(7)} ${fp.name}`);
  }
}

const counts = {
  rows: rows.length,
  errors: rows.filter((r) => r.verdict === "error").length,
  warnings: rows.filter((r) => r.verdict === "warning").length,
  reviews: rows.filter((r) => r.verdict === "review").length,
  ok: rows.filter((r) => r.verdict === "ok").length,
};

const summary = {
  generatedAt: new Date().toISOString(),
  releaseMode,
  counts,
  rows,
};
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, "report.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
writeFileSync(
  path.join(outDir, "report.html"),
  `<!doctype html><meta charset="utf-8"><title>OpenPCB 3D placement audit</title>` +
    `<style>body{font-family:system-ui,sans-serif;margin:2rem;background:#0f1115;color:#c9d1d9}` +
    `table{border-collapse:collapse;width:100%}td,th{border:1px solid #30363d;padding:.4rem;text-align:left;vertical-align:top;font-size:13px}` +
    `.error{color:#f85149}.warning{color:#d29922}.review{color:#a371f7}.ok{color:#3fb950}pre{margin:0;font-size:11px;color:#8b949e}</style>` +
    `<h1>3D placement audit</h1>` +
    `<p>${counts.rows} rows — <span class="ok">${counts.ok} ok</span>, <span class="error">${counts.errors} errors</span>, <span class="warning">${counts.warnings} warnings</span>, <span class="review">${counts.reviews} reviews</span>.</p>` +
    `<table><thead><tr><th>Footprint</th><th>Mount</th><th>Verdict</th><th>Bounds (mm)</th><th>Findings</th></tr></thead><tbody>` +
    rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.footprintName)}<br><small>${escapeHtml(row.footprintId)}</small></td>` +
          `<td>${escapeHtml(row.mountType)}</td>` +
          `<td class="${row.verdict}">${row.verdict}</td>` +
          `<td><pre>${escapeHtml(fmtBounds(row.bounds))}</pre></td>` +
          `<td>${row.findings.map((f) => `<div class="${f.severity}">${f.severity}/${f.check}: ${escapeHtml(f.message)}</div>`).join("") || "<span class=ok>—</span>"}</td></tr>`,
      )
      .join("") +
    `</tbody></table>`,
);

console.log(
  `[audit-3d] ${counts.ok} ok, ${counts.errors} errors, ${counts.warnings} warnings, ${counts.reviews} reviews → ${path.join(outDir, "report.html")}`,
);
if (releaseMode && counts.errors > 0) {
  console.error(
    `[audit-3d] release gate FAILED: ${counts.errors} orientation error(s)`,
  );
  process.exit(1);
}
