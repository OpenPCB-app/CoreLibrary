#!/usr/bin/env bun
/**
 * Visual 3D-placement contact sheet.
 *
 * For every footprint+model: bake the GLB (same transform policy as pack),
 * measure it, run the orientation gate, then render a TOP and ISO view of the
 * model sitting on its footprint's pad/silk outline (scene frame: Z-up, mm).
 * A single WebGL context composites every view onto one 2D canvas (browsers cap
 * live WebGL contexts, so we can't give each part its own), which Playwright
 * screenshots into `dist/audit-3d-placement/contact-sheet.png`.
 *
 * Use it to eyeball orientations the numeric gate can't fully judge (pin-1
 * alignment, mirror correctness, polarity).
 *
 *   bun tools/render-3d-contact-sheet.ts [--only=<substr>]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";
import {
  convertModel,
  evaluatePlacement,
  type FootprintSidecar,
  type ModelSidecar,
} from "./placement-eval";

const args = new Set(process.argv.slice(2));
const onlyArg = [...args]
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length);

const OUT_DIR = path.join(REPO_ROOT, "dist", "audit-3d-placement");
const CONTACT_DIR = path.join(OUT_DIR, "contact");
const GLB_DIR = path.join(CONTACT_DIR, "glb");
const THREE_ROOT = path.join(REPO_ROOT, "node_modules", "three");

// Composite-sheet layout — MUST stay in sync with the same literals in VIEWER_HTML.
// The canvas is drawn at the page origin at DPR=1 (the full-page PNG width equals
// the resize width), so a row's cell rect in canvas coords == its rect in PNG px.
const TILE = 220,
  GAP = 8,
  LABEL = 26,
  COLS = 2;
const CELL_W = TILE * 2 + GAP; // top + iso side by side
const CELL_H = TILE + LABEL;
// Worst-first ordering for the sheet + gallery.
const VERDICT_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  review: 2,
  ok: 3,
};

type Preview = NonNullable<FootprintSidecar["normalized"]>["preview"];

interface Row {
  footprintId: string;
  footprintName: string;
  mountType: string;
  glbFile: string;
  preview: Preview;
  bounds: Awaited<ReturnType<typeof convertModel>>["bounds"];
  findings: ReturnType<typeof evaluatePlacement>["findings"];
  verdict: ReturnType<typeof evaluatePlacement>["verdict"];
  /** Cell rect in the composite PNG (px), so the gallery builder can crop this tile. */
  tile?: { x: number; y: number; w: number; h: number };
}

function slug(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, "_");
}

async function build(): Promise<Row[]> {
  const models = new Map<string, ModelSidecar>();
  for (const file of walkFiles(path.join(REPO_ROOT, "3d"), ".model.json")) {
    const m = loadJson<ModelSidecar>(file);
    models.set(m.id, m);
  }

  rmSync(CONTACT_DIR, { recursive: true, force: true });
  mkdirSync(GLB_DIR, { recursive: true });

  const rows: Row[] = [];
  for (const file of walkFiles(
    path.join(REPO_ROOT, "footprints"),
    ".fp.json",
  )) {
    const fp = loadJson<FootprintSidecar>(file);
    if (
      onlyArg &&
      !`${fp.id} ${fp.name}`.toLowerCase().includes(onlyArg.toLowerCase())
    ) {
      continue;
    }
    for (const modelId of fp.models3d ?? []) {
      const model = models.get(modelId);
      if (!model?.formats.step) continue;
      let converted;
      try {
        converted = await convertModel(model);
      } catch (error) {
        console.error(
          `[contact-sheet] skip ${fp.id}: ${(error as Error).message}`,
        );
        continue;
      }
      const glbFile = `${slug(fp.id)}.glb`;
      writeFileSync(path.join(GLB_DIR, glbFile), converted.glbBytes);
      const placement = evaluatePlacement(fp, converted.bounds);
      rows.push({
        footprintId: fp.id,
        footprintName: fp.name ?? fp.id,
        mountType: fp.mountType ?? "other",
        glbFile,
        preview: fp.normalized?.preview ?? { pads: [], graphics: [] },
        bounds: converted.bounds,
        findings: placement.findings,
        verdict: placement.verdict,
      });
      console.log(`[contact-sheet] ${placement.verdict.padEnd(7)} ${fp.name}`);
    }
  }

  // Worst-first so the sheet + gallery lead with problems; stable within a rank.
  rows.sort(
    (a, b) => (VERDICT_RANK[a.verdict] ?? 9) - (VERDICT_RANK[b.verdict] ?? 9),
  );
  // Assign each row its cell rect in the composite PNG (matches VIEWER_HTML layout,
  // 1px border padding included) so build-3d-report can crop deterministically.
  rows.forEach((row, i) => {
    const col = i % COLS;
    const r = Math.floor(i / COLS);
    const x0 = GAP + col * (CELL_W + GAP);
    const y0 = GAP + r * (CELL_H + GAP);
    row.tile = { x: x0 - 1, y: y0 - 1, w: CELL_W + 2, h: CELL_H + 2 };
  });

  // three itself is served live from node_modules under /three/ (see server).
  writeFileSync(
    path.join(CONTACT_DIR, "manifest.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  writeFileSync(path.join(CONTACT_DIR, "viewer.html"), VIEWER_HTML);
  return rows;
}

const VIEWER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>LOADING</title>
<style>html,body{margin:0;background:#0f1115}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/":"/three/"}}</script>
</head><body>
<canvas id="sheet"></canvas>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/three/examples/jsm/loaders/GLTFLoader.js";

const TILE = 220, GAP = 8, LABEL = 26, COLS = 2;            // 2 footprints / row, top+iso each
const VIEW_W = TILE, VIEW_H = TILE;
const CELL_W = VIEW_W * 2 + GAP;                            // top + iso
const CELL_H = VIEW_H + LABEL;

const rows = await (await fetch("./manifest.json")).json();
const sheet = document.getElementById("sheet");
const rowsCount = Math.ceil(rows.length / COLS);
sheet.width = COLS * CELL_W + (COLS + 1) * GAP;
sheet.height = rowsCount * CELL_H + (rowsCount + 1) * GAP;
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#0f1115"; ctx.fillRect(0, 0, sheet.width, sheet.height);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(VIEW_W, VIEW_H);
renderer.setClearColor(0x161a20, 1);
const loader = new GLTFLoader();
const VERDICT_COLOR = { ok: "#3fb950", review: "#a371f7", warning: "#d29922", error: "#f85149" };

function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1));
  const d = new THREE.DirectionalLight(0xffffff, 1.4); d.position.set(3, -5, 8); scene.add(d);
}
function boardPlane(bounds, ref) {
  const g = new THREE.Group();
  // pad rectangles (green) at z=0
  for (const p of ref.pads ?? []) {
    if (!p.centerMm || p.widthMm == null || p.heightMm == null) continue;
    const geo = new THREE.PlaneGeometry(p.widthMm, p.heightMm);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2ea043, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.position.set(p.centerMm.x, p.centerMm.y, 0.01); g.add(m);
  }
  // silk graphics (white) at z=0
  const pts = [];
  for (const s of ref.graphics ?? []) {
    if (s.a && s.b) { pts.push(new THREE.Vector3(s.a.x, s.a.y, 0.02), new THREE.Vector3(s.b.x, s.b.y, 0.02)); }
  }
  if (pts.length) {
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xcccccc })));
  }
  // origin axes
  const ax = new THREE.AxesHelper(Math.max(1, (bounds.size.x + bounds.size.y) / 4)); g.add(ax);
  return g;
}
function frame(scene, camera, bounds, ref, mode) {
  // combined bbox of model + footprint reference
  let minX = Math.min(bounds.min.x, ...padX(ref, -1)), maxX = Math.max(bounds.max.x, ...padX(ref, 1));
  let minY = Math.min(bounds.min.y, ...padY(ref, -1)), maxY = Math.max(bounds.max.y, ...padY(ref, 1));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (bounds.min.z + bounds.max.z) / 2;
  const radius = Math.max(maxX - minX, maxY - minY, bounds.size.z, 1) * 0.62 + 1;
  const dist = radius * 2.4;
  const center = new THREE.Vector3(cx, cy, cz);
  if (mode === "top") { camera.up.set(0, 1, 0); camera.position.set(cx, cy, cz + dist); }
  else { camera.up.set(0, 0, 1); camera.position.set(cx + dist * 0.85, cy - dist * 0.85, cz + dist * 0.8); }
  camera.lookAt(center);
}
function padX(ref, sign) { const out = []; for (const p of ref.pads ?? []) if (p.centerMm && p.widthMm != null) out.push(p.centerMm.x + sign * p.widthMm / 2); for (const s of ref.graphics ?? []) { if (s.a) out.push(s.a.x); if (s.b) out.push(s.b.x); } return out.length ? out : [0]; }
function padY(ref, sign) { const out = []; for (const p of ref.pads ?? []) if (p.centerMm && p.heightMm != null) out.push(p.centerMm.y + sign * p.heightMm / 2); for (const s of ref.graphics ?? []) { if (s.a) out.push(s.a.y); if (s.b) out.push(s.b.y); } return out.length ? out : [0]; }

async function loadGlb(file) {
  const buf = await (await fetch("./glb/" + file)).arrayBuffer();
  return await new Promise((res, rej) => loader.parse(buf, "", (g) => res(g.scene), rej));
}

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const col = i % COLS, r = Math.floor(i / COLS);
  const x0 = GAP + col * (CELL_W + GAP), y0 = GAP + r * (CELL_H + GAP);
  let model = null;
  try { model = await loadGlb(row.glbFile); } catch (e) { /* draw error tile below */ }
  for (const [vi, mode] of [[0, "top"], [1, "iso"]]) {
    const scene = new THREE.Scene(); lights(scene);
    if (model) scene.add(model.clone(true));
    scene.add(boardPlane(row.bounds, row.preview));
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    frame(scene, cam, row.bounds, row.preview, mode);
    renderer.render(scene, cam);
    ctx.drawImage(renderer.domElement, x0 + vi * (VIEW_W + GAP), y0 + LABEL, VIEW_W, VIEW_H);
  }
  // label + verdict border
  const color = VERDICT_COLOR[row.verdict] || "#888";
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 1, y0 - 1, CELL_W + 2, CELL_H + 2);
  ctx.fillStyle = color; ctx.font = "13px monospace";
  ctx.fillText(row.verdict.toUpperCase() + "  " + row.footprintName + "  [" + row.mountType + "]", x0 + 4, y0 + 17);
  ctx.fillStyle = "#8b949e"; ctx.font = "10px monospace";
  const bz = row.bounds;
  ctx.fillText("z[" + bz.min.z.toFixed(2) + "," + bz.max.z.toFixed(2) + "] c(" + bz.center.x.toFixed(2) + "," + bz.center.y.toFixed(2) + ")", x0 + VIEW_W + GAP + 4, y0 + 17);
}

window.__DONE__ = true; document.title = "READY";
</script></body></html>`;

// --- Playwright driver --------------------------------------------------------
async function pw(cmdArgs: string[]): Promise<string> {
  const proc = Bun.spawn(["playwright-cli", ...cmdArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;
  return out + err;
}

async function main(): Promise<void> {
  const rows = await build();
  if (rows.length === 0) {
    console.error("[contact-sheet] no rows to render");
    process.exit(1);
  }

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/") p = "/viewer.html";
      // Serve the real three package (incl. its split internal modules) so the
      // viewer's ESM imports resolve without fragile per-file vendoring.
      if (p.startsWith("/three/")) {
        return new Response(
          Bun.file(path.join(THREE_ROOT, p.slice("/three/".length))),
        );
      }
      return new Response(Bun.file(path.join(CONTACT_DIR, p)));
    },
  });
  const url = `http://localhost:${server.port}/viewer.html`;
  const pngPath = path.join(OUT_DIR, "contact-sheet.png");

  try {
    await pw(["open"]);
    await pw(["resize", "1000", "6000"]);
    await pw(["goto", url]);
    // Wait for the page to finish compositing (title flips to READY).
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const res = await pw(["eval", "() => document.title"]);
      if (res.includes("Page Title: READY")) {
        ready = true;
        break;
      }
      await Bun.sleep(500);
    }
    if (!ready)
      console.warn(
        "[contact-sheet] timed out waiting for READY; screenshotting anyway",
      );
    await pw(["screenshot", "--filename", pngPath, "--full-page"]);
  } finally {
    await pw(["close"]);
    server.stop(true);
  }

  console.log(`[contact-sheet] wrote ${pngPath} (${rows.length} models)`);
  console.log(
    `[contact-sheet] open viewer live: serve ${CONTACT_DIR} and load viewer.html`,
  );
}

await main();
