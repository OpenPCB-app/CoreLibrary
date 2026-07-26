#!/usr/bin/env bun
/**
 * Rewrite component `parameters` onto the canonical vocabulary in
 * `parameter-dictionary.ts`: apply aliases, drop keys that duplicate
 * structured fields, and report anything still outside the per-category
 * allow-list so it can be added to the dictionary or fixed at the source.
 *
 *   bun tools/normalize-parameters.ts [--dry-run]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, relPath, walkFiles } from "./lib";
import {
  normalizeParameters,
  unknownParameterKeys,
} from "./parameter-dictionary";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function run(argv: string[]): Promise<void> {
  for (const arg of argv) {
    if (arg !== "--dry-run") throw new Error(`Unknown argument: ${arg}`);
  }
  const dryRun = argv.includes("--dry-run");

  let changed = 0;
  const renames = new Map<string, number>();
  const drops = new Map<string, number>();
  const unknown: Array<{ file: string; category: string; keys: string[] }> = [];

  for (const file of walkFiles(
    path.join(REPO_ROOT, "components"),
    ".component.json",
  )) {
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isObject(data)) throw new Error(`${relPath(file)} must be an object`);
    if (!isObject(data.parameters)) continue;

    const before = JSON.stringify(data.parameters);
    const result = normalizeParameters(data.parameters);
    data.parameters = result.parameters;

    for (const r of result.renamed) {
      const key = `${r.from} -> ${r.to}`;
      renames.set(key, (renames.get(key) ?? 0) + 1);
    }
    for (const d of result.dropped) drops.set(d, (drops.get(d) ?? 0) + 1);

    const leftover = unknownParameterKeys(
      String(data.category),
      result.parameters,
    );
    if (leftover.length > 0) {
      unknown.push({
        file: relPath(file),
        category: String(data.category),
        keys: leftover,
      });
    }

    if (JSON.stringify(data.parameters) === before) continue;
    if (!dryRun) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    changed += 1;
  }

  const verb = dryRun ? "would rewrite" : "rewrote";
  console.log(`[normalize-parameters] ${verb} ${changed} component(s)`);
  if (renames.size > 0) {
    console.log("  renames:");
    for (const [key, n] of [...renames].sort()) console.log(`    ${key} (${n})`);
  }
  if (drops.size > 0) {
    console.log("  drops:");
    for (const [key, n] of [...drops].sort()) console.log(`    ${key} (${n})`);
  }
  if (unknown.length > 0) {
    console.log(
      `\n  ${unknown.length} component(s) still carry keys outside the dictionary:`,
    );
    for (const u of unknown) {
      console.log(`    ${u.file} [${u.category}]: ${u.keys.join(", ")}`);
    }
    process.exitCode = 1;
  }
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[normalize-parameters] ${message}`);
  process.exit(1);
});
