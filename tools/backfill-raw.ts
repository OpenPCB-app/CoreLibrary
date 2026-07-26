#!/usr/bin/env bun
/**
 * Populate the `raw` blob on footprint sidecars that carry only the 2-key
 * placeholder (`{kind, name}`) written by the retired seed importer.
 *
 * Without a real `raw` these footprints cannot be re-normalized offline, so
 * they miss every preview-builder improvement — courtyard geometry, pad
 * `layers[]`, package codes. They are also the most-placed parts in the
 * library (R/C 0402-2512, disc caps, axial resistors).
 *
 * Each sidecar already records its own KiCad origin in
 * `provenance.sourceLibrary` + `provenance.sourceFileName`, so no manifest is
 * needed. `provenance.sourceHash` embeds the sha1 of the original source file
 * and is verified before anything is written: a mismatch means the vendored
 * checkout has drifted from what was seeded, and re-parsing would silently
 * change geometry.
 *
 * This only fills `raw`. Run `rebuild-previews.ts` afterwards to regenerate
 * the preview and package code from it.
 *
 *   bun tools/backfill-raw.ts [--dry-run] [--kicad-root=<path>]
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseKicadFootprint } from "@openpcb/kicad-parsers";
import { REPO_ROOT, relPath, walkFiles } from "./lib";

const DEFAULT_KICAD_ROOT = path.resolve(
  REPO_ROOT,
  "..",
  "references",
  "kicad-libs",
);

interface Args {
  dryRun: boolean;
  kicadRoot: string;
}

function parseArgs(argv: string[]): Args {
  const kicadRoot =
    argv
      .find((a) => a.startsWith("--kicad-root="))
      ?.slice("--kicad-root=".length) ?? DEFAULT_KICAD_ROOT;
  for (const arg of argv) {
    if (arg !== "--dry-run" && !arg.startsWith("--kicad-root=")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun: argv.includes("--dry-run"), kicadRoot: path.resolve(kicadRoot) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Seeded hashes are `kicad:<file>:<sha1>:v1`. Pull the sha1 out so it can be
 * checked against the vendored source.
 */
function embeddedSha1(sourceHash: unknown): string | null {
  const match = /^kicad:.*:([0-9a-f]{40}):v\d+$/.exec(String(sourceHash ?? ""));
  return match?.[1] ?? null;
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const filled: string[] = [];
  const alreadyOk: string[] = [];

  for (const file of walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json")) {
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isObject(data)) throw new Error(`${relPath(file)} must be an object`);
    if (isObject(data.raw) && Array.isArray(data.raw.pads)) {
      alreadyOk.push(String(data.id));
      continue;
    }

    const provenance = data.provenance;
    if (!isObject(provenance)) {
      throw new Error(`${relPath(file)} has no provenance`);
    }
    const library = String(provenance.sourceLibrary ?? "").replace(
      /^KiCad\s+/,
      "",
    );
    const fileName = String(provenance.sourceFileName ?? "");
    if (!library.endsWith(".pretty") || !fileName.endsWith(".kicad_mod")) {
      throw new Error(
        `${relPath(file)}: cannot resolve a KiCad source from provenance (library="${library}", file="${fileName}")`,
      );
    }

    const source = path.join(
      args.kicadRoot,
      "kicad-footprints",
      library,
      fileName,
    );
    if (!existsSync(source)) {
      throw new Error(`${relPath(file)}: missing KiCad source ${source}`);
    }

    const content = await readFile(source, "utf8");
    const expected = embeddedSha1(provenance.sourceHash);
    if (expected) {
      const actual = createHash("sha1").update(content).digest("hex");
      if (actual !== expected) {
        throw new Error(
          `${relPath(file)}: vendored source has drifted (sha1 ${actual} != seeded ${expected}). ` +
            `Re-parsing would change geometry — reconcile the checkout first.`,
        );
      }
    }

    data.raw = parseKicadFootprint(content);
    if (!args.dryRun) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    filled.push(String(data.id));
  }

  const verb = args.dryRun ? "would fill" : "filled";
  console.log(
    `[backfill-raw] ${verb} ${filled.length} stub raw blob(s); ${alreadyOk.length} already had one`,
  );
  for (const id of filled) console.log(`  ${id}`);
  if (filled.length > 0 && !args.dryRun) {
    console.log("\nNext: bun tools/rebuild-previews.ts --footprints");
  }
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backfill-raw] ${message}`);
  process.exit(1);
});
