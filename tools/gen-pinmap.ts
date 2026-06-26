/**
 * gen-pinmap — emit an explicit identity `pinMap` for a KiCad footprint.
 *
 * `import-kicad-batch --strict` never auto-fills a pinMap; for standard parts
 * (symbol pin numbers == pad numbers) the map is pure identity over the pads.
 * This tool reads a footprint's pads via the SAME parse path the importer uses
 * (`parseKicadFootprint` → `buildFootprintPreviewFromParsed`), so the emitted
 * pad numbers match what import/validate expect, and prints the pinMap JSON to
 * paste into a manifest footprint entry. Replaces the lost ad-hoc gen-p4/p5
 * generators with a committed, repeatable tool.
 *
 * Usage:
 *   bun tools/gen-pinmap.ts --footprint=Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod
 *   bun tools/gen-pinmap.ts --footprint=<path> \
 *     --pad-override=4:2          # tab/EP pad 4 → electrical pin 2 (repeatable)
 *     --non-electrical=MP         # mechanical pad MP → {nonElectrical:true} (repeatable; pairs with the importer's nonElectrical handling)
 *     --kicad-root=../references/kicad-libs
 *
 * Flags use `--flag=value` form (matching the importer).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseKicadFootprint } from "@openpcb/kicad-parsers";
import { buildFootprintPreviewFromParsed } from "@openpcb/kicad-import";
import { REPO_ROOT } from "./lib";

const DEFAULT_KICAD_ROOT = path.resolve(
  REPO_ROOT,
  "..",
  "references",
  "kicad-libs",
);

interface PinMapEntry {
  pinNumber: string;
  padNumber: string;
  nonElectrical?: boolean;
}

function parseArgs(argv: string[]): {
  footprint: string;
  kicadRoot: string;
  padOverrides: Map<string, string>;
  nonElectrical: Set<string>;
} {
  const values = new Map<string, string>();
  const padOverrides = new Map<string, string>();
  const nonElectrical = new Set<string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match)
      throw new Error(`unrecognized argument: ${arg} (use --flag=value)`);
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (key === "pad-override") {
      const [pad, pin] = value.split(":");
      if (!pad || !pin)
        throw new Error(`--pad-override must be <pad>:<pin>, got: ${value}`);
      padOverrides.set(pad, pin);
    } else if (key === "non-electrical") {
      nonElectrical.add(value);
    } else {
      values.set(key, value);
    }
  }
  const footprint = values.get("footprint");
  if (!footprint) throw new Error("missing required --footprint=<path>");
  return {
    footprint,
    kicadRoot: path.resolve(values.get("kicad-root") ?? DEFAULT_KICAD_ROOT),
    padOverrides,
    nonElectrical,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = path.isAbsolute(args.footprint)
    ? args.footprint
    : path.resolve(args.kicadRoot, args.footprint);
  if (!existsSync(source)) throw new Error(`footprint not found: ${source}`);

  const parsed = parseKicadFootprint(await readFile(source, "utf8"));
  const preview = buildFootprintPreviewFromParsed(parsed);

  // Pads in source order; track empties/duplicates for the author.
  const seen = new Set<string>();
  const pinMap: PinMapEntry[] = [];
  const empties: number[] = [];
  const duplicates: string[] = [];
  preview.pads.forEach((pad, index) => {
    const num = (pad.number ?? "").trim();
    if (num.length === 0) {
      empties.push(index);
      return;
    }
    if (seen.has(num)) {
      duplicates.push(num);
      return;
    }
    seen.add(num);
    const entry: PinMapEntry = {
      pinNumber: args.padOverrides.get(num) ?? num,
      padNumber: num,
    };
    if (args.nonElectrical.has(num)) entry.nonElectrical = true;
    pinMap.push(entry);
  });

  // Diagnostics go to stderr so stdout stays paste-ready JSON.
  const warn = (m: string): void => {
    process.stderr.write(`[gen-pinmap] ${m}\n`);
  };
  warn(`${path.basename(source)} — ${pinMap.length} mapped pad(s)`);
  if (empties.length > 0)
    warn(
      `${empties.length} unnumbered pad(s) skipped (NPTH/mechanical) — handle via --non-electrical or omit`,
    );
  if (duplicates.length > 0)
    warn(
      `duplicate pad number(s) collapsed to one entry: ${[...new Set(duplicates)].join(", ")}`,
    );
  for (const [pad, pin] of args.padOverrides)
    if (!seen.has(pad))
      warn(`--pad-override pad "${pad}" not present in footprint`);
  for (const pad of args.nonElectrical)
    if (!seen.has(pad))
      warn(`--non-electrical pad "${pad}" not present in footprint`);

  process.stdout.write(`${JSON.stringify(pinMap, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[gen-pinmap] ${(error as Error).message}\n`);
  process.exit(1);
});
