#!/usr/bin/env bun
/**
 * Symbol render verification sheet + overlap gate.
 *
 * Re-parses each library symbol's stored `raw.rawSource` with the CURRENT
 * (linked) kicad-parsers + kicad-import + rendering-core, rebuilds its preview
 * render model, draws it to a 2D canvas (graphics + pins + name/number labels),
 * and screenshots a labelled contact sheet via Playwright. Also runs a text
 * overlap gate (no pin-name/number or name/name label boxes may collide), the
 * structural regression guard for the symbol fixes.
 *
 *   bun tools/render-symbol-contact-sheet.ts [--only=<substr>]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSymbolPreviewFromParsed } from "@openpcb/kicad-import";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";
import { findSymbolTextOverlaps } from "./symbol-gate";

const args = new Set(process.argv.slice(2));
const onlyArg = [...args]
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length);

const OUT_DIR = path.join(REPO_ROOT, "dist", "audit-symbols");

interface SymbolFile {
  id: string;
  name?: string;
  /** Stored ParsedKicadSymbol (extends-resolved) — fed to the preview builder. */
  raw?: unknown;
}

interface Row {
  id: string;
  name: string;
  model: unknown;
  overlaps: string[];
}

function build(): Row[] {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const rows: Row[] = [];
  for (const file of walkFiles(
    path.join(REPO_ROOT, "symbols"),
    ".symbol.json",
  )) {
    const sym = loadJson<SymbolFile>(file);
    if (
      onlyArg &&
      !`${sym.id} ${sym.name}`.toLowerCase().includes(onlyArg.toLowerCase())
    ) {
      continue;
    }
    // Render the STORED parsed symbol (the importer resolves KiCad `(extends)`
    // and flattens body graphics into `raw`; `rawSource` is only the per-symbol
    // stub and would be empty for derived parts like 74HC00/LM358). This is the
    // exact ParsedKicadSymbol the app feeds to buildSymbolPreviewFromParsed.
    if (!sym.raw || !Array.isArray((sym.raw as { pins?: unknown }).pins)) {
      // Hand-authored symbols (some passives) have no parsed KiCad `raw`; the
      // app renders those from a different path. Skip here.
      console.error(`[symbols] ${sym.id}: no parsed raw symbol — skipped`);
      continue;
    }
    let model: any;
    try {
      model = buildSymbolPreviewFromParsed(sym.raw as never);
    } catch (error) {
      console.error(`[symbols] ${sym.id}: ${(error as Error).message}`);
      continue;
    }
    const overlaps = findSymbolTextOverlaps(model.labels ?? []);
    rows.push({ id: sym.id, name: sym.name ?? sym.id, model, overlaps });
    const tag = overlaps.length ? `✗ ${overlaps.length} overlap` : "✓ ok";
    console.log(`[symbols] ${tag.padEnd(14)} ${sym.name}`);
  }

  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  writeFileSync(path.join(OUT_DIR, "viewer.html"), VIEWER_HTML);
  return rows;
}

const VIEWER_HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>LOADING</title>
<style>html,body{margin:0;background:#0f1115}</style></head><body>
<canvas id="sheet"></canvas>
<script>
const TILE = 320, GAP = 10, LABEL = 28, COLS = 3;
const CELL_W = TILE, CELL_H = TILE + LABEL;
fetch("./manifest.json").then(r=>r.json()).then(rows=>{
  const cv = document.getElementById("sheet");
  const rc = Math.ceil(rows.length / COLS);
  cv.width = COLS*CELL_W + (COLS+1)*GAP;
  cv.height = rc*CELL_H + (rc+1)*GAP;
  const g = cv.getContext("2d");
  g.fillStyle = "#0f1115"; g.fillRect(0,0,cv.width,cv.height);

  function modelBounds(m){
    let m0={x:1e9,y:1e9}, m1={x:-1e9,y:-1e9};
    const grow=(p)=>{m0.x=Math.min(m0.x,p.x);m0.y=Math.min(m0.y,p.y);m1.x=Math.max(m1.x,p.x);m1.y=Math.max(m1.y,p.y);};
    for(const gr of m.graphics){
      if(gr.kind==="line"){grow(gr.a);grow(gr.b);}
      else if(gr.kind==="rect"){grow({x:gr.x,y:gr.y});grow({x:gr.x+gr.width,y:gr.y+gr.height});}
      else if(gr.kind==="circle"){grow({x:gr.center.x-gr.radiusMm,y:gr.center.y-gr.radiusMm});grow({x:gr.center.x+gr.radiusMm,y:gr.center.y+gr.radiusMm});}
      else if(gr.kind==="arc3"){grow(gr.start);grow(gr.mid);grow(gr.end);}
      else if(gr.kind==="polyline"||gr.kind==="bezier"){for(const p of gr.points)grow(p);}
    }
    for(const p of m.pins){grow(p.anchor);grow(p.bodyEnd);}
    for(const l of m.labels){grow(l.at);}
    if(m0.x>m1.x){m0={x:-5,y:-5};m1={x:5,y:5};}
    return {m0,m1};
  }

  rows.forEach((row,i)=>{
    const m=row.model;
    const col=i%COLS, r=Math.floor(i/COLS);
    const x0=GAP+col*(CELL_W+GAP), y0=GAP+r*(CELL_H+GAP);
    const {m0,m1}=modelBounds(m);
    const w=m1.x-m0.x||1, h=m1.y-m0.y||1;
    const pad=18;
    const s=Math.min((TILE-2*pad)/w,(TILE-2*pad)/h);
    const cx=(m0.x+m1.x)/2, cy=(m0.y+m1.y)/2;
    const ox=x0+TILE/2, oy=y0+LABEL+TILE/2;
    const X=(x)=>ox+(x-cx)*s, Y=(y)=>oy-(y-cy)*s; // flip Y (KiCad Y-up → canvas Y-down)

    // verdict border
    g.strokeStyle=row.overlaps.length?"#f85149":"#3fb950"; g.lineWidth=2;
    g.strokeRect(x0-1,y0-1,CELL_W+2,CELL_H+2);
    g.fillStyle=row.overlaps.length?"#f85149":"#3fb950"; g.font="13px monospace";
    g.fillText((row.overlaps.length?"✗ "+row.overlaps.length+" overlap  ":"✓ ok  ")+row.name, x0+5, y0+18);

    // graphics
    g.strokeStyle="#d6dde6"; g.fillStyle="rgba(255,255,255,0.04)"; g.lineWidth=1.4;
    for(const gr of m.graphics){
      g.beginPath();
      if(gr.kind==="line"){g.moveTo(X(gr.a.x),Y(gr.a.y));g.lineTo(X(gr.b.x),Y(gr.b.y));g.stroke();}
      else if(gr.kind==="rect"){const rx=X(Math.min(gr.x,gr.x+gr.width)),ry=Y(Math.max(gr.y,gr.y+gr.height));g.strokeRect(rx,ry,Math.abs(gr.width*s),Math.abs(gr.height*s));}
      else if(gr.kind==="circle"){g.arc(X(gr.center.x),Y(gr.center.y),gr.radiusMm*s,0,7);g.stroke();}
      else if(gr.kind==="arc3"){
        // quick 3-point arc via quadratic through mid
        g.moveTo(X(gr.start.x),Y(gr.start.y));
        g.quadraticCurveTo(X(gr.mid.x*2-(gr.start.x+gr.end.x)/2),Y(gr.mid.y*2-(gr.start.y+gr.end.y)/2),X(gr.end.x),Y(gr.end.y));
        g.stroke();
      }
      else if(gr.kind==="polyline"){gr.points.forEach((p,k)=>k?g.lineTo(X(p.x),Y(p.y)):g.moveTo(X(p.x),Y(p.y)));if(gr.closed)g.closePath();g.stroke();}
      else if(gr.kind==="bezier"){const p=gr.points;g.moveTo(X(p[0].x),Y(p[0].y));g.bezierCurveTo(X(p[1].x),Y(p[1].y),X(p[2].x),Y(p[2].y),X(p[3].x),Y(p[3].y));g.stroke();}
    }

    // pins (line + terminal dot)
    g.strokeStyle="#9aa7b4"; g.lineWidth=1.2;
    for(const p of m.pins){
      g.beginPath();g.moveTo(X(p.anchor.x),Y(p.anchor.y));g.lineTo(X(p.bodyEnd.x),Y(p.bodyEnd.y));g.stroke();
      g.fillStyle="#7fd1e8";g.beginPath();g.arc(X(p.anchor.x),Y(p.anchor.y),2.5,0,7);g.fill();
    }

    // label boxes (overlap visualization) + text
    for(const l of m.labels){
      const isNum=l.role==="pin-number", isName=l.role==="pin-name";
      if(!isNum&&!isName) continue;
      const fs=Math.max(8,l.fontSizeMm*s);
      g.save();
      g.translate(X(l.at.x),Y(l.at.y));
      if(l.rotationDeg) g.rotate(-l.rotationDeg*Math.PI/180);
      g.font=fs+"px monospace";
      g.textAlign=l.anchorX==="center"?"center":l.anchorX==="right"?"right":"left";
      g.textBaseline="middle";
      g.fillStyle=isNum?"#e3b341":"#7ee787";
      g.fillText(l.text,0,0);
      g.restore();
    }
  });

  window.__DONE__=true; document.title="READY";
});
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
  const rows = build();
  if (rows.length === 0) {
    console.error("[symbols] no symbols rendered");
    process.exit(1);
  }
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/") p = "/viewer.html";
      return new Response(Bun.file(path.join(OUT_DIR, p)));
    },
  });
  const url = `http://localhost:${server.port}/viewer.html`;
  const pngPath = path.join(OUT_DIR, "symbol-sheet.png");
  try {
    await pw(["open"]);
    await pw(["resize", "1100", "3000"]);
    await pw(["goto", url]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const res = await pw(["eval", "() => document.title"]);
      if (res.includes("Page Title: READY")) {
        ready = true;
        break;
      }
      await Bun.sleep(400);
    }
    if (!ready)
      console.warn(
        "[symbols] timed out waiting for READY; screenshotting anyway",
      );
    await pw(["screenshot", "--filename", pngPath, "--full-page"]);
  } finally {
    await pw(["close"]);
    server.stop(true);
  }
  const bad = rows.filter((r) => r.overlaps.length).length;
  console.log(
    `[symbols] ${rows.length} symbols, ${bad} with text overlaps → ${pngPath}`,
  );
  for (const r of rows.filter((r) => r.overlaps.length)) {
    console.log(`  ✗ ${r.name}: ${r.overlaps.join("; ")}`);
  }
}

await main();
