#!/usr/bin/env bun
/**
 * Assemble a self-contained, worst-first VISUAL 3D-placement report from the
 * contact-sheet render. For every footprint+model it crops that row's TOP+ISO
 * cell out of `contact-sheet.png` (deterministically, using the tile rect the
 * render tool emitted into `contact/manifest.json`), embeds it as a data-URI,
 * and lays the cards out worst-first with verdict badge, findings, the model
 * sidecar transform (identity / mirror / offset), z-range, and the component
 * ids that use each placement.
 *
 * Prereqs: run `bun run audit:3d` then `bun tools/render-3d-contact-sheet.ts`
 * first (this tool only reads their output). Needs ImageMagick `magick` on PATH.
 *
 * Output: dist/audit-3d-placement/index.html (open directly or publish as an
 * Artifact — fully self-contained, no WebGL / no external requests).
 *
 *   bun tools/build-3d-report.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";
import type { FootprintSidecar, ModelSidecar } from "./placement-eval";

const OUT_DIR = path.join(REPO_ROOT, "dist", "audit-3d-placement");
const CONTACT_DIR = path.join(OUT_DIR, "contact");
const SHEET = path.join(OUT_DIR, "contact-sheet.png");
const MANIFEST = path.join(CONTACT_DIR, "manifest.json");
const REPORT = path.join(OUT_DIR, "report.json");
const TILES_DIR = path.join(OUT_DIR, "tiles");
const OUT_HTML = path.join(OUT_DIR, "index.html");

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface Finding {
  check: string;
  severity: string;
  message: string;
}
interface ManifestRow {
  footprintId: string;
  footprintName: string;
  mountType: string;
  bounds: { min: Vec3; max: Vec3; size: Vec3; center: Vec3 };
  findings: Finding[];
  verdict: string;
  tile?: { x: number; y: number; w: number; h: number };
}

const VERDICT_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  review: 2,
  ok: 3,
};
const VERDICT_COLOR: Record<string, string> = {
  ok: "#3fb950",
  review: "#a371f7",
  warning: "#d29922",
  error: "#f85149",
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

const isZero = (v?: Vec3) => !v || (v.x === 0 && v.y === 0 && v.z === 0);
const isOne = (v?: Vec3) => !v || (v.x === 1 && v.y === 1 && v.z === 1);

/** Human-readable transform tag from a model sidecar's offset/rotation/scale. */
function transformTag(model?: ModelSidecar): { label: string; identity: boolean } {
  if (!model) return { label: "no model", identity: false };
  const o = model.offsetMm as Vec3 | undefined;
  const r = model.rotationDeg as Vec3 | undefined;
  const s = model.scaleMm as Vec3 | undefined;
  const parts: string[] = [];
  if (s && (s.x === -1 || s.y === -1 || s.z === -1)) {
    const ax = (["x", "y", "z"] as const).filter((a) => s[a] === -1).join(",");
    parts.push(`mirror ${ax}`);
  } else if (!isOne(s)) {
    parts.push(`scale ${s!.x},${s!.y},${s!.z}`);
  }
  if (!isZero(r)) parts.push(`rot ${r!.x},${r!.y},${r!.z}°`);
  if (!isZero(o)) parts.push(`offset ${o!.x},${o!.y},${o!.z}`);
  return parts.length
    ? { label: parts.join(" · "), identity: false }
    : { label: "identity", identity: true };
}

// --- load render + audit output ----------------------------------------------
for (const f of [SHEET, MANIFEST]) {
  if (!existsSync(f)) {
    console.error(
      `[build-3d-report] missing ${path.relative(REPO_ROOT, f)} — run render-3d-contact-sheet.ts first`,
    );
    process.exit(1);
  }
}
const rows = loadJson<ManifestRow[]>(MANIFEST);
const generatedAt = existsSync(REPORT)
  ? (loadJson<{ generatedAt?: string }>(REPORT).generatedAt ?? "")
  : "";

// footprint id -> its model sidecar (via models3d[0]); footprint id -> components
const models = new Map<string, ModelSidecar>();
for (const file of walkFiles(path.join(REPO_ROOT, "3d"), ".model.json")) {
  const m = loadJson<ModelSidecar>(file);
  models.set(m.id, m);
}
const fpModel = new Map<string, ModelSidecar | undefined>();
for (const file of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
  const fp = loadJson<FootprintSidecar>(file);
  fpModel.set(fp.id, models.get(fp.models3d?.[0] ?? ""));
}
interface ComponentSidecar {
  id: string;
  name?: string;
  defaultFootprint?: string;
  footprints?: { footprint: string }[];
}
const fpComponents = new Map<string, { id: string; name: string }[]>();
for (const file of walkFiles(path.join(REPO_ROOT, "components"), ".component.json")) {
  const c = loadJson<ComponentSidecar>(file);
  const fps = new Set<string>();
  if (c.defaultFootprint) fps.add(c.defaultFootprint);
  for (const f of c.footprints ?? []) if (f.footprint) fps.add(f.footprint);
  for (const fpid of fps) {
    const list = fpComponents.get(fpid) ?? [];
    list.push({ id: c.id, name: c.name ?? c.id });
    fpComponents.set(fpid, list);
  }
}

// --- crop each tile out of the composite -> data URI -------------------------
rmSync(TILES_DIR, { recursive: true, force: true });
mkdirSync(TILES_DIR, { recursive: true });

function cropTileDataUri(row: ManifestRow, i: number): string {
  const t = row.tile;
  if (!t) return "";
  const out = path.join(TILES_DIR, `tile-${i}.png`);
  const res = Bun.spawnSync([
    "magick",
    SHEET,
    "-crop",
    `${t.w}x${t.h}+${t.x}+${t.y}`,
    "+repage",
    `png8:${out}`,
  ]);
  if (!res.success || !existsSync(out)) {
    console.error(`[build-3d-report] crop failed for ${row.footprintName}`);
    return "";
  }
  const b64 = Buffer.from(readFileSync(out)).toString("base64");
  return `data:image/png;base64,${b64}`;
}

rows.sort(
  (a, b) => (VERDICT_RANK[a.verdict] ?? 9) - (VERDICT_RANK[b.verdict] ?? 9),
);

const counts = { ok: 0, warning: 0, review: 0, error: 0 } as Record<string, number>;
for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

const cards: string[] = [];
rows.forEach((row, i) => {
  const uri = cropTileDataUri(row, i);
  const color = VERDICT_COLOR[row.verdict] ?? "#8b949e";
  const tag = transformTag(fpModel.get(row.footprintId));
  const comps = fpComponents.get(row.footprintId) ?? [];
  const b = row.bounds;
  const findings = row.findings.length
    ? row.findings
        .map(
          (f) =>
            `<div class="finding f-${f.severity}"><b>${esc(f.check)}</b> · ${esc(f.severity)}: ${esc(f.message)}</div>`,
        )
        .join("")
    : `<div class="finding f-ok">no findings</div>`;
  const compHtml = comps.length
    ? comps
        .map((c) => `<span class="chip">${esc(c.name)}</span>`)
        .join("")
    : `<span class="chip chip-none">—</span>`;
  cards.push(`
  <section class="card" data-verdict="${row.verdict}" style="--vc:${color}">
    <div class="thumb">${uri ? `<img loading="lazy" src="${uri}" alt="${esc(row.footprintName)}">` : `<div class="noimg">no image</div>`}</div>
    <div class="meta">
      <div class="head">
        <span class="badge" style="background:${color}">${row.verdict.toUpperCase()}</span>
        <span class="fname">${esc(row.footprintName)}</span>
        <span class="mount">${esc(row.mountType)}</span>
      </div>
      <div class="row"><span class="lbl">transform</span><span class="tform ${tag.identity ? "t-id" : "t-mod"}">${esc(tag.label)}</span></div>
      <div class="row"><span class="lbl">z-range</span><span class="mono">[${b.min.z.toFixed(2)}, ${b.max.z.toFixed(2)}] mm · center (${b.center.x.toFixed(2)}, ${b.center.y.toFixed(2)})</span></div>
      <div class="findings">${findings}</div>
      <div class="comps"><span class="lbl">used by ${comps.length}</span> ${compHtml}</div>
    </div>
  </section>`);
});

const total = rows.length;
const html = `<title>3D Placement Audit — CoreLibrary</title>
<style>
  /* Neutral tokens carry a slight cool-blue bias echoing the #0f1115 render
     viewport this report documents. Semantic verdict hexes are set inline
     (they read on both grounds against near-black card text). */
  :root, :root[data-theme="light"] {
    color-scheme: light dark;
    --bg: #f4f6f9; --surface: #ffffff; --border: #d3dae2;
    --text: #1c2430; --muted: #5b6672; --chip: #eaeef3;
    --finding: #f0f3f7; --header-bg: #ffffffe6; --thumb: #0f1115;
    --ok: #1a7f37; --warning: #9a6700; --review: #8250df; --error: #cf222e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --surface: #161a20; --border: #2b323c;
      --text: #c9d1d9; --muted: #8b949e; --chip: #21262d;
      --finding: #1c222b; --header-bg: #161a20ee; --thumb: #0b0d10;
      --ok: #3fb950; --warning: #d29922; --review: #a371f7; --error: #f85149;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f1115; --surface: #161a20; --border: #2b323c;
    --text: #c9d1d9; --muted: #8b949e; --chip: #21262d;
    --finding: #1c222b; --header-bg: #161a20ee; --thumb: #0b0d10;
    --ok: #3fb950; --warning: #d29922; --review: #a371f7; --error: #f85149;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 -apple-system, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--text); }
  header { position: sticky; top: 0; z-index: 5; padding: 14px 20px; background: var(--header-bg); backdrop-filter: blur(6px); border-bottom: 1px solid var(--border); }
  h1 { font-size: 17px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { font-size: 12px; color: var(--muted); }
  .counts { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .pill { font-size: 12px; padding: 3px 10px; border-radius: 999px; font-weight: 600; color: #0b0d10; font-variant-numeric: tabular-nums; }
  .filters { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
  .filters button { font: inherit; font-size: 12px; padding: 3px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
  .filters button:hover { border-color: var(--muted); }
  .filters button.active { background: var(--chip); border-color: var(--muted); }
  .filters button:focus-visible { outline: 2px solid #4c8fff; outline-offset: 1px; }
  main { padding: 16px 20px 60px; display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 14px; }
  .card { border: 1px solid var(--border); border-left: 4px solid var(--vc); border-radius: 8px; overflow: hidden; background: var(--surface); }
  .thumb { background: var(--thumb); line-height: 0; }
  .thumb img { width: 100%; height: auto; display: block; }
  .noimg { padding: 40px; text-align: center; color: var(--muted); line-height: 1.4; }
  .meta { padding: 10px 12px 12px; }
  .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 5px; color: #0b0d10; }
  .fname { font-weight: 600; font-size: 13px; word-break: break-word; }
  .mount { font-size: 11px; color: var(--muted); margin-left: auto; text-transform: uppercase; letter-spacing: .04em; }
  .row { display: flex; gap: 8px; font-size: 12px; margin: 3px 0; }
  .lbl { color: var(--muted); min-width: 74px; flex-shrink: 0; }
  .mono, .tform { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-variant-numeric: tabular-nums; }
  .tform.t-id { color: var(--muted); }
  .tform.t-mod { color: var(--warning); font-weight: 600; }
  .findings { margin: 8px 0; display: flex; flex-direction: column; gap: 3px; }
  .finding { font-size: 11px; padding: 4px 8px; border-radius: 5px; background: var(--finding); }
  .f-error { border-left: 3px solid var(--error); }
  .f-warning { border-left: 3px solid var(--warning); }
  .f-review { border-left: 3px solid var(--review); }
  .f-ok { color: var(--muted); }
  .comps { margin-top: 8px; font-size: 11px; display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
  .chip { background: var(--chip); padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .chip-none { color: var(--muted); }
</style>
<header>
  <h1>3D Placement Audit — CoreLibrary</h1>
  <div class="sub">${total} unique footprint·model placements · TOP + ISO on footprint · worst-first${generatedAt ? ` · audited ${esc(generatedAt)}` : ""}</div>
  <div class="counts">
    <span class="pill" style="background:${VERDICT_COLOR.error}">${counts.error ?? 0} error</span>
    <span class="pill" style="background:${VERDICT_COLOR.warning}">${counts.warning ?? 0} warning</span>
    <span class="pill" style="background:${VERDICT_COLOR.review}">${counts.review ?? 0} review</span>
    <span class="pill" style="background:${VERDICT_COLOR.ok}">${counts.ok ?? 0} ok</span>
  </div>
  <div class="filters">
    <button data-f="all" class="active">All (${total})</button>
    <button data-f="error">Errors (${counts.error ?? 0})</button>
    <button data-f="warning">Warnings (${counts.warning ?? 0})</button>
    <button data-f="ok">OK (${counts.ok ?? 0})</button>
  </div>
</header>
<main id="grid">
${cards.join("\n")}
</main>
<script>
  const btns = document.querySelectorAll(".filters button");
  const cards = document.querySelectorAll(".card");
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    const f = b.dataset.f;
    cards.forEach((c) => { c.style.display = (f === "all" || c.dataset.verdict === f) ? "" : "none"; });
  }));
</script>`;

writeFileSync(OUT_HTML, html);
rmSync(TILES_DIR, { recursive: true, force: true });
const bytes = Buffer.byteLength(html);
console.log(
  `[build-3d-report] wrote ${path.relative(REPO_ROOT, OUT_HTML)} — ${total} cards, ${(bytes / 1e6).toFixed(2)} MB` +
    ` (${counts.error ?? 0} err / ${counts.warning ?? 0} warn / ${counts.ok ?? 0} ok)`,
);
