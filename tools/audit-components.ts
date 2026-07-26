#!/usr/bin/env bun
/**
 * Per-component visual audit: for every component, render its SYMBOL, its
 * default FOOTPRINT (2D top view) and its 3D MODEL placed on that footprint
 * (iso), side by side, each with a verdict. Also runs:
 *   - symbol text-overlap gate (pin name/number collisions),
 *   - 3D orientation gate for the default AND every footprint variant,
 *   - cross-reference checks (symbol/footprint/model resolve, STEP present,
 *     pin-map covers the symbol pins).
 *
 * Output: dist/audit-components/component-audit.png (+ report.json, viewer.html).
 *
 *   bun tools/audit-components.ts [--only=<substr>] [--no-render]
 *
 * --no-render skips the Playwright contact sheet and runs only the headless
 * gate logic (symbol overlap, orientation, cross-refs) — the CI path.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSymbolPreviewFromParsed } from "@openpcb/kicad-import";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";
import {
  convertModel,
  evaluatePlacement,
  type FootprintSidecar,
  type ModelSidecar,
} from "./placement-eval";
import { findSymbolTextOverlaps } from "./symbol-gate";
import type { ModelBounds } from "./glb-bounds";
import type { Finding } from "./orientation-gate";

const args = new Set(process.argv.slice(2));
const onlyArg = [...args]
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length);
const noRender = args.has("--no-render");
const OUT_DIR = path.join(REPO_ROOT, "dist", "audit-components");
const GLB_DIR = path.join(OUT_DIR, "glb");
const THREE_ROOT = path.join(REPO_ROOT, "node_modules", "three");

interface SymbolFile {
  id: string;
  name?: string;
  raw?: { pins?: unknown[] };
  normalized?: { pins?: Array<{ number?: string }>; preview?: unknown };
}
interface ComponentFile {
  id: string;
  name?: string;
  category?: string;
  symbol: string;
  defaultFootprint: string;
  footprints: Array<{
    footprint: string;
    pinMap?: Array<{ pinNumber: string; padNumber: string }>;
  }>;
}

interface VariantResult {
  footprintId: string;
  verdict: string;
  findings: Finding[];
}
interface Row {
  componentId: string;
  name: string;
  category: string;
  symbolModel: unknown | null;
  footprint: {
    id: string;
    name: string;
    mountType: string;
    preview: unknown;
  } | null;
  glbFile: string | null;
  bounds: ModelBounds | null;
  symbolOverlaps: string[];
  placement: { verdict: string; findings: Finding[] } | null;
  xref: string[];
  variants: VariantResult[];
}

function slug(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, "_");
}

// Convert each referenced model once; reused across component variants.
const modelCache = new Map<
  string,
  { bounds: ModelBounds; glbBytes: Uint8Array } | null
>();
async function modelData(model: ModelSidecar | undefined) {
  if (!model) return null;
  if (modelCache.has(model.id)) return modelCache.get(model.id) ?? null;
  let data: { bounds: ModelBounds; glbBytes: Uint8Array } | null = null;
  try {
    data = await convertModel(model);
  } catch {
    data = null;
  }
  modelCache.set(model.id, data);
  return data;
}

function symbolRenderModel(sym: SymbolFile): unknown | null {
  // KiCad-imported symbols: rebuild via the (fixed) preview builder so the audit
  // reflects current rendering. Hand-authored symbols expose a ready render
  // model in normalized.preview.
  if (sym.raw && Array.isArray(sym.raw.pins) && sym.raw.pins.length > 0) {
    try {
      return buildSymbolPreviewFromParsed(sym.raw as never);
    } catch {
      return null;
    }
  }
  const preview = sym.normalized?.preview as { kind?: string } | undefined;
  if (preview && preview.kind === "symbol") return preview;
  return null;
}

async function build(): Promise<Row[]> {
  const symbols = new Map<string, SymbolFile>();
  for (const f of walkFiles(path.join(REPO_ROOT, "symbols"), ".symbol.json")) {
    const s = loadJson<SymbolFile>(f);
    symbols.set(s.id, s);
  }
  const footprints = new Map<string, FootprintSidecar>();
  for (const f of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
    const fp = loadJson<FootprintSidecar>(f);
    footprints.set(fp.id, fp);
  }
  const models = new Map<string, ModelSidecar>();
  for (const f of walkFiles(path.join(REPO_ROOT, "3d"), ".model.json")) {
    const m = loadJson<ModelSidecar>(f);
    models.set(m.id, m);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(GLB_DIR, { recursive: true });

  const rows: Row[] = [];
  for (const file of walkFiles(
    path.join(REPO_ROOT, "components"),
    ".component.json",
  )) {
    const comp = loadJson<ComponentFile>(file);
    if (
      onlyArg &&
      !`${comp.id} ${comp.name}`.toLowerCase().includes(onlyArg.toLowerCase())
    ) {
      continue;
    }
    const xref: string[] = [];

    // --- symbol ---
    const sym = symbols.get(comp.symbol);
    if (!sym) xref.push(`missing symbol ${comp.symbol}`);
    const symbolModel = sym ? symbolRenderModel(sym) : null;
    if (sym && !symbolModel) xref.push("symbol has no renderable model");
    const symbolOverlaps = symbolModel
      ? findSymbolTextOverlaps(
          ((symbolModel as { labels?: [] }).labels ?? []) as never,
          ((symbolModel as { pins?: [] }).pins ?? []) as never,
        )
      : [];

    // pin-map coverage (symbol pin numbers must all be mapped on every variant)
    const symbolPinNumbers = new Set(
      (sym?.normalized?.pins ?? [])
        .map((p) => p.number)
        .filter((n): n is string => typeof n === "string" && n.length > 0),
    );

    // --- default footprint + model (rendered) ---
    const defFp = footprints.get(comp.defaultFootprint);
    if (!defFp) xref.push(`missing defaultFootprint ${comp.defaultFootprint}`);
    let glbFile: string | null = null;
    let bounds: ModelBounds | null = null;
    let placement: Row["placement"] = null;
    if (defFp) {
      const modelId = defFp.models3d?.[0];
      const model = modelId ? models.get(modelId) : undefined;
      // `no3d` footprints (mounting holes, fiducials) legitimately have none.
      if (!modelId && !defFp.no3d)
        xref.push(`footprint ${defFp.id} has no 3D model`);
      else if (modelId && !model) xref.push(`missing 3D model ${modelId}`);
      const md = await modelData(model);
      if (model && !md) xref.push(`3D conversion failed for ${model.id}`);
      if (md) {
        glbFile = `${slug(comp.id)}.glb`;
        writeFileSync(path.join(GLB_DIR, glbFile), md.glbBytes);
        bounds = md.bounds;
        placement = evaluatePlacement(defFp, md.bounds);
      }
    }

    // --- every footprint variant: cross-ref + orientation gate ---
    const variants: VariantResult[] = [];
    for (const v of comp.footprints) {
      const fp = footprints.get(v.footprint);
      if (!fp) {
        xref.push(`missing footprint variant ${v.footprint}`);
        continue;
      }
      const mapped = new Set((v.pinMap ?? []).map((p) => p.pinNumber));
      for (const n of symbolPinNumbers) {
        if (!mapped.has(n)) xref.push(`${v.footprint}: pin ${n} not in pinMap`);
      }
      const modelId = fp.models3d?.[0];
      const model = modelId ? models.get(modelId) : undefined;
      const md = await modelData(model);
      if (md) {
        const p = evaluatePlacement(fp, md.bounds);
        variants.push({
          footprintId: v.footprint,
          verdict: p.verdict,
          findings: p.findings,
        });
      } else if (fp.no3d) {
        variants.push({ footprintId: v.footprint, verdict: "no3d", findings: [] });
      } else {
        variants.push({
          footprintId: v.footprint,
          verdict: "error",
          findings: [
            {
              check: "ref",
              severity: "error",
              message: "no renderable 3D model",
            },
          ],
        });
      }
    }

    rows.push({
      componentId: comp.id,
      name: comp.name ?? comp.id,
      category: comp.category ?? "",
      symbolModel,
      footprint: defFp
        ? {
            id: defFp.id,
            name: defFp.name ?? defFp.id,
            mountType: defFp.mountType ?? "other",
            preview: defFp.normalized?.preview ?? {},
          }
        : null,
      glbFile,
      bounds,
      symbolOverlaps,
      placement,
      xref,
      variants,
    });

    const bad =
      xref.length ||
      symbolOverlaps.length ||
      placement?.verdict === "error" ||
      variants.some((v) => v.verdict === "error");
    console.log(`[components] ${bad ? "✗" : "✓"} ${comp.name}`);
  }

  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  writeFileSync(path.join(OUT_DIR, "viewer.html"), VIEWER_HTML);
  return rows;
}

const VIEWER_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>LOADING</title>
<style>html,body{margin:0;background:#0f1115}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/":"/three/"}}</script>
</head><body>
<canvas id="sheet"></canvas>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/three/examples/jsm/loaders/GLTFLoader.js";

const PANEL = 300, GAP = 10, HEAD = 30, COLS = 3;
const rows = await (await fetch("./manifest.json")).json();
const cv = document.getElementById("sheet");
const ROW_H = PANEL + HEAD + GAP;
cv.width = COLS * PANEL + (COLS + 1) * GAP;
cv.height = rows.length * ROW_H + GAP;
const g = cv.getContext("2d");
g.fillStyle = "#0f1115"; g.fillRect(0, 0, cv.width, cv.height);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(PANEL, PANEL); renderer.setClearColor(0x161a20, 1);
const loader = new GLTFLoader();

function fit(g2, items, x0, y0, draw){ // items: [{x,y}] for bounds
  let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  for(const p of items){mnx=Math.min(mnx,p.x);mny=Math.min(mny,p.y);mxx=Math.max(mxx,p.x);mxy=Math.max(mxy,p.y);}
  if(mnx>mxx){mnx=-5;mny=-5;mxx=5;mxy=5;}
  const w=mxx-mnx||1,h=mxy-mny||1,pad=22,s=Math.min((PANEL-2*pad)/w,(PANEL-2*pad)/h);
  const cx=(mnx+mxx)/2,cy=(mny+mxy)/2,ox=x0+PANEL/2,oy=y0+PANEL/2;
  draw((x)=>ox+(x-cx)*s,(y)=>oy-(y-cy)*s,s);
}

function symbolPoints(m){const pts=[];for(const gr of m.graphics||[]){if(gr.kind==="line"){pts.push(gr.a,gr.b);}else if(gr.kind==="rect"){pts.push({x:gr.x,y:gr.y},{x:gr.x+gr.width,y:gr.y+gr.height});}else if(gr.kind==="circle"){pts.push({x:gr.center.x-gr.radiusMm,y:gr.center.y-gr.radiusMm},{x:gr.center.x+gr.radiusMm,y:gr.center.y+gr.radiusMm});}else if(gr.kind==="arc3"){pts.push(gr.start,gr.mid,gr.end);}else if(gr.points){for(const p of gr.points)pts.push(p);}}for(const p of m.pins||[]){pts.push(p.anchor,p.bodyEnd);}for(const l of m.labels||[])pts.push(l.at);return pts.length?pts:[{x:0,y:0}];}

function drawSymbol(m,x0,y0){
  fit(g,symbolPoints(m),x0,y0,(X,Y,s)=>{
    g.strokeStyle="#d6dde6";g.lineWidth=1.3;
    for(const gr of m.graphics||[]){g.beginPath();
      if(gr.kind==="line"){g.moveTo(X(gr.a.x),Y(gr.a.y));g.lineTo(X(gr.b.x),Y(gr.b.y));g.stroke();}
      else if(gr.kind==="rect"){g.strokeRect(X(Math.min(gr.x,gr.x+gr.width)),Y(Math.max(gr.y,gr.y+gr.height)),Math.abs(gr.width*s),Math.abs(gr.height*s));}
      else if(gr.kind==="circle"){g.arc(X(gr.center.x),Y(gr.center.y),gr.radiusMm*s,0,7);g.stroke();}
      else if(gr.kind==="arc3"){g.moveTo(X(gr.start.x),Y(gr.start.y));g.quadraticCurveTo(X(gr.mid.x*2-(gr.start.x+gr.end.x)/2),Y(gr.mid.y*2-(gr.start.y+gr.end.y)/2),X(gr.end.x),Y(gr.end.y));g.stroke();}
      else if(gr.kind==="polyline"){gr.points.forEach((p,k)=>k?g.lineTo(X(p.x),Y(p.y)):g.moveTo(X(p.x),Y(p.y)));if(gr.closed)g.closePath();g.stroke();}
      else if(gr.kind==="bezier"){const p=gr.points;g.moveTo(X(p[0].x),Y(p[0].y));g.bezierCurveTo(X(p[1].x),Y(p[1].y),X(p[2].x),Y(p[2].y),X(p[3].x),Y(p[3].y));g.stroke();}}
    g.strokeStyle="#9aa7b4";for(const p of m.pins||[]){g.beginPath();g.moveTo(X(p.anchor.x),Y(p.anchor.y));g.lineTo(X(p.bodyEnd.x),Y(p.bodyEnd.y));g.stroke();g.fillStyle="#7fd1e8";g.beginPath();g.arc(X(p.anchor.x),Y(p.anchor.y),2,0,7);g.fill();}
    for(const l of m.labels||[]){if(l.role!=="pin-name"&&l.role!=="pin-number")continue;g.save();g.translate(X(l.at.x),Y(l.at.y));if(l.rotationDeg)g.rotate(-l.rotationDeg*Math.PI/180);g.font=Math.max(8,l.fontSizeMm*s)+"px monospace";g.textAlign=l.anchorX==="center"?"center":l.anchorX==="right"?"right":"left";g.textBaseline="middle";g.fillStyle=l.role==="pin-number"?"#e3b341":"#7ee787";g.fillText(l.text,0,0);g.restore();}
  });
}

function fpPoints(pv){const pts=[];for(const p of pv.pads||[]){if(p.centerMm){pts.push({x:p.centerMm.x-(p.widthMm||0)/2,y:p.centerMm.y-(p.heightMm||0)/2},{x:p.centerMm.x+(p.widthMm||0)/2,y:p.centerMm.y+(p.heightMm||0)/2});}}for(const s of pv.graphics||[]){if(s.a)pts.push(s.a);if(s.b)pts.push(s.b);}return pts.length?pts:[{x:0,y:0}];}

function drawFootprint(pv,x0,y0){
  fit(g,fpPoints(pv),x0,y0,(X,Y,s)=>{
    for(const p of pv.pads||[]){if(!p.centerMm)continue;g.fillStyle="rgba(212,160,23,0.85)";const w=(p.widthMm||0.5)*s,h=(p.heightMm||0.5)*s;g.fillRect(X(p.centerMm.x)-w/2,Y(p.centerMm.y)-h/2,w,h);g.fillStyle="#0f1115";g.font="10px monospace";g.textAlign="center";g.textBaseline="middle";g.fillText(p.number||"",X(p.centerMm.x),Y(p.centerMm.y));}
    g.strokeStyle="#c9d1d9";g.lineWidth=1;g.beginPath();for(const sg of pv.graphics||[]){if(sg.a&&sg.b){g.moveTo(X(sg.a.x),Y(sg.a.y));g.lineTo(X(sg.b.x),Y(sg.b.y));}}g.stroke();
  });
}

async function loadGlb(file){const buf=await(await fetch("./glb/"+file)).arrayBuffer();return await new Promise((res,rej)=>loader.parse(buf,"",(gl)=>res(gl.scene),rej));}

function draw3d(model,bounds,pv,x0,y0){
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x404040,1.1));
  const dl=new THREE.DirectionalLight(0xffffff,1.4);dl.position.set(3,-5,8);scene.add(dl);
  if(model)scene.add(model);
  for(const p of pv.pads||[]){if(!p.centerMm)continue;const geo=new THREE.PlaneGeometry(p.widthMm||0.5,p.heightMm||0.5);const mat=new THREE.MeshBasicMaterial({color:0x2ea043,transparent:true,opacity:0.55,side:THREE.DoubleSide});const mh=new THREE.Mesh(geo,mat);mh.position.set(p.centerMm.x,p.centerMm.y,0.01);scene.add(mh);}
  const pts=[];for(const sg of pv.graphics||[]){if(sg.a&&sg.b)pts.push(new THREE.Vector3(sg.a.x,sg.a.y,0.02),new THREE.Vector3(sg.b.x,sg.b.y,0.02));}
  if(pts.length)scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xcccccc})));
  const b=bounds;const cx=b?b.center.x:0,cy=b?b.center.y:0,cz=b?(b.min.z+b.max.z)/2:0;
  const r=(b?Math.max(b.size.x,b.size.y,b.size.z):5)*0.62+1,dist=r*2.6;
  const cam=new THREE.PerspectiveCamera(35,1,0.01,1000);cam.up.set(0,0,1);cam.position.set(cx+dist*0.85,cy-dist*0.85,cz+dist*0.8);cam.lookAt(new THREE.Vector3(cx,cy,cz));
  renderer.render(scene,cam);g.drawImage(renderer.domElement,x0,y0,PANEL,PANEL);
}

for(let i=0;i<rows.length;i++){
  const row=rows[i];const y0=GAP+i*ROW_H;
  const bad=row.xref.length||row.symbolOverlaps.length||row.placement?.verdict==="error"||row.variants.some(v=>v.verdict==="error");
  g.strokeStyle=bad?"#f85149":"#3fb950";g.lineWidth=2;g.strokeRect(GAP-2,y0-2,COLS*PANEL+(COLS-1)*GAP+4,PANEL+HEAD+4);
  g.fillStyle=bad?"#f85149":"#3fb950";g.font="14px monospace";
  const vbad=row.variants.filter(v=>v.verdict==="error").length;
  g.fillText((bad?"✗ ":"✓ ")+row.name+"   [sym "+(row.symbolOverlaps.length?"✗":"ok")+" | place "+(row.placement?row.placement.verdict:"?")+" | xref "+(row.xref.length?row.xref.length+" err":"ok")+" | variants "+(row.variants.length-vbad)+"/"+row.variants.length+"]",GAP+2,y0+18);
  const px=[GAP,GAP*2+PANEL,GAP*3+2*PANEL];const py=y0+HEAD;
  // panel labels
  g.fillStyle="#6e7681";g.font="11px monospace";
  g.fillText("symbol",px[0]+4,py+12);g.fillText("footprint: "+(row.footprint?row.footprint.name:"—"),px[1]+4,py+12);g.fillText("3D on footprint",px[2]+4,py+12);
  if(row.symbolModel)drawSymbol(row.symbolModel,px[0],py);
  if(row.footprint)drawFootprint(row.footprint.preview,px[1],py);
  let m3=null;if(row.glbFile){try{m3=await loadGlb(row.glbFile);}catch(e){}}
  if(row.footprint)draw3d(m3,row.bounds,row.footprint.preview,px[2],py);
}

window.__DONE__=true;document.title="READY";
</script></body></html>`;

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
    console.error("[components] nothing to audit");
    process.exit(1);
  }
  if (!noRender) await renderContactSheet(rows);
  await report(rows);
}

/**
 * Playwright contact sheet. Split out so CI can run the gate logic headless:
 * the symbol-overlap, orientation and cross-reference checks are what catch
 * regressions, and they need no browser.
 */
async function renderContactSheet(rows: Row[]): Promise<void> {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/") p = "/viewer.html";
      if (p.startsWith("/three/"))
        return new Response(Bun.file(path.join(THREE_ROOT, p.slice(7))));
      return new Response(Bun.file(path.join(OUT_DIR, p)));
    },
  });
  const url = `http://localhost:${server.port}/viewer.html`;
  const pngPath = path.join(OUT_DIR, "component-audit.png");
  try {
    await pw(["open"]);
    await pw(["resize", "1000", "6000"]);
    await pw(["goto", url]);
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
        "[components] timed out waiting for READY; screenshotting anyway",
      );
    await pw(["screenshot", "--filename", pngPath, "--full-page"]);
  } finally {
    await pw(["close"]);
    server.stop(true);
  }
}

async function report(rows: Row[]): Promise<void> {
  const pngPath = path.join(OUT_DIR, "component-audit.png");
  // report.json + console summary
  const report = rows.map((r) => ({
    component: r.componentId,
    name: r.name,
    symbolOverlaps: r.symbolOverlaps,
    placement: r.placement?.verdict ?? "n/a",
    xref: r.xref,
    variantErrors: r.variants
      .filter((v) => v.verdict === "error")
      .map((v) => v.footprintId),
  }));
  writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const bad = rows.filter(
    (r) =>
      r.xref.length ||
      r.symbolOverlaps.length ||
      r.placement?.verdict === "error" ||
      r.variants.some((v) => v.verdict === "error"),
  );
  console.log(
    `[components] ${rows.length} components, ${bad.length} with issues` +
      (noRender ? "" : ` → ${pngPath}`),
  );
  for (const r of bad) {
    const parts: string[] = [];
    if (r.symbolOverlaps.length)
      parts.push(`symbol: ${r.symbolOverlaps.join(", ")}`);
    if (r.placement?.verdict === "error")
      parts.push(
        `placement: ${r.placement.findings
          .filter((f) => f.severity === "error")
          .map((f) => f.message)
          .join("; ")}`,
      );
    if (r.xref.length) parts.push(`xref: ${r.xref.join("; ")}`);
    const ve = r.variants.filter((v) => v.verdict === "error");
    if (ve.length)
      parts.push(
        `variant placement errors: ${ve.map((v) => v.footprintId).join(", ")}`,
      );
    console.log(`  ✗ ${r.name}: ${parts.join(" | ")}`);
  }

  // Exit non-zero so this can actually gate. It previously always exited 0,
  // which made it a report rather than a check.
  if (bad.length > 0) process.exitCode = 1;
}

await main();
