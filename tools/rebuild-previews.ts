#!/usr/bin/env bun
/**
 * Re-normalize every symbol / footprint preview model in place from the `raw`
 * blob each sidecar already carries. No KiCad checkout is needed: `raw` is the
 * full parsed structure, so a rebuild is byte-identical to what a re-import
 * would produce.
 *
 * Run this after any change to the shared preview builders
 * (`@openpcb/kicad-import` buildSymbolPreviewFromParsed /
 * buildFootprintPreviewFromParsed) to propagate it across the library.
 *
 * SYMBOLS additionally get `normalized.pins[].localPosition` re-derived from
 * the rebuilt preview anchors. This is load-bearing, not cosmetic: the app
 * wires from `normalized.pins`, NOT from the preview. KiCad draws every unit of
 * a multi-unit symbol at the same coordinates, so without this sync the
 * composed preview would look right while the electrical pins stayed
 * coincident — shorting e.g. all four LM324 op-amp outputs onto one net.
 *
 *   bun tools/rebuild-previews.ts [--dry-run] [--only=<substr>] [--symbols|--footprints]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFootprintPreviewFromParsed,
  buildSymbolPreviewFromParsed,
} from "@openpcb/kicad-import";
import { REPO_ROOT, packageCodeFor, relPath, walkFiles } from "./lib";

interface Args {
  dryRun: boolean;
  only: string | null;
  symbols: boolean;
  footprints: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv);
  const only =
    argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null;
  const symbolsOnly = flags.has("--symbols");
  const footprintsOnly = flags.has("--footprints");
  return {
    dryRun: flags.has("--dry-run"),
    only,
    // Neither flag = do both.
    symbols: symbolsOnly || !footprintsOnly,
    footprints: footprintsOnly || !symbolsOnly,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sidecars written by the pre-importer seed tool carry a 2-key placeholder
 * (`{kind, name}`) instead of a real parse; those cannot be rebuilt offline.
 *
 * The test is structural, not "has entries": a pinless symbol (mounting hole,
 * fiducial) legitimately parses to zero pins and is perfectly rebuildable.
 */
function hasUsableRaw(raw: unknown, kind: "footprint" | "symbol"): boolean {
  if (!isObject(raw)) return false;
  return kind === "footprint"
    ? Array.isArray(raw.pads) && Array.isArray(raw.graphics)
    : Array.isArray(raw.pins) && Array.isArray(raw.bodyGraphics);
}

/** Match `import-kicad-batch.ts` / `pack.ts` byte-for-byte. */
async function writeJson(
  file: string,
  data: unknown,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

interface Report {
  rebuilt: string[];
  skippedStubRaw: string[];
  unchanged: string[];
}

function emptyReport(): Report {
  return { rebuilt: [], skippedStubRaw: [], unchanged: [] };
}

async function rebuildFootprints(args: Args): Promise<Report> {
  const report = emptyReport();
  for (const file of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
    if (args.only && !file.includes(args.only)) continue;
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isObject(data)) throw new Error(`${relPath(file)} must be an object`);
    const id = String(data.id);

    if (!hasUsableRaw(data.raw, "footprint")) {
      report.skippedStubRaw.push(id);
      continue;
    }

    const normalized = data.normalized;
    if (!isObject(normalized)) {
      throw new Error(`${relPath(file)} has no normalized block`);
    }

    const before = JSON.stringify([normalized.preview, data.package]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw is the parsed structure by construction (guarded above).
    normalized.preview = buildFootprintPreviewFromParsed(data.raw as any);

    // `package.code` was dropped by the importer, so it is undefined
    // library-wide and pack.ts's `code ?? imperial ?? metric` chain never
    // resolves. Recompute from the footprint name, matching what the importer
    // now persists.
    const pkg = packageCodeFor(String(data.name));
    normalized.packageCode = pkg;
    data.package = pkg;

    if (JSON.stringify([normalized.preview, data.package]) === before) {
      report.unchanged.push(id);
      continue;
    }

    await writeJson(file, data, args.dryRun);
    report.rebuilt.push(id);
  }
  return report;
}

/**
 * Re-point every electrical pin at its rebuilt preview anchor. Preview pin ids
 * are `u<unit>:<number>`, which is exactly `normalized.pins[].originPinKey`.
 */
function syncPinPositions(
  normalizedPins: unknown,
  preview: ReturnType<typeof buildSymbolPreviewFromParsed>,
  symbolId: string,
): void {
  if (!Array.isArray(normalizedPins)) return;
  const anchorByKey = new Map(preview.pins.map((p) => [p.id, p.anchor]));

  for (const pin of normalizedPins) {
    if (!isObject(pin)) continue;
    const key = String(pin.originPinKey);
    const anchor = anchorByKey.get(key);
    if (!anchor) {
      // A pin with no preview counterpart means the preview dropped it (hidden
      // pin, DeMorgan body). Leaving a stale coordinate would silently
      // reintroduce the collision this sync exists to remove.
      throw new Error(
        `${symbolId}: pin ${key} has no preview anchor — preview and normalized.pins are out of sync`,
      );
    }
    pin.localPosition = { x: anchor.x, y: anchor.y };
  }
}

async function rebuildSymbols(args: Args): Promise<Report> {
  const report = emptyReport();
  for (const file of walkFiles(path.join(REPO_ROOT, "symbols"), ".symbol.json")) {
    if (args.only && !file.includes(args.only)) continue;
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isObject(data)) throw new Error(`${relPath(file)} must be an object`);
    const id = String(data.id);

    if (!hasUsableRaw(data.raw, "symbol")) {
      report.skippedStubRaw.push(id);
      continue;
    }

    const normalized = data.normalized;
    if (!isObject(normalized)) {
      throw new Error(`${relPath(file)} has no normalized block`);
    }

    const before = JSON.stringify(normalized);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw is the parsed structure by construction (guarded above).
    const preview = buildSymbolPreviewFromParsed(data.raw as any);
    normalized.preview = preview;
    syncPinPositions(normalized.pins, preview, id);

    if (JSON.stringify(normalized) === before) {
      report.unchanged.push(id);
      continue;
    }

    await writeJson(file, data, args.dryRun);
    report.rebuilt.push(id);
  }
  return report;
}

function print(kind: string, report: Report, dryRun: boolean): void {
  const verb = dryRun ? "would rebuild" : "rebuilt";
  console.log(
    `[rebuild-previews] ${kind}: ${verb} ${report.rebuilt.length}, unchanged ${report.unchanged.length}, skipped ${report.skippedStubRaw.length} (stub raw)`,
  );
  for (const id of report.skippedStubRaw) {
    console.log(`  skip (no rebuildable raw): ${id}`);
  }
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.footprints) {
    print("footprints", await rebuildFootprints(args), args.dryRun);
  }
  if (args.symbols) {
    print("symbols", await rebuildSymbols(args), args.dryRun);
  }
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[rebuild-previews] ${message}`);
  process.exit(1);
});
