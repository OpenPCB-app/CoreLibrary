import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Ajv, { type AnySchema } from "ajv/dist/2020";
import addFormats from "ajv-formats";

export const REPO_ROOT = path.resolve(import.meta.dir, "..");
export const ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export function sha256File(absPath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(absPath));
  return hash.digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function walkFiles(absRoot: string, suffix: string): string[] {
  const out: string[] = [];
  function recur(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) recur(full);
      else if (st.isFile() && full.endsWith(suffix)) out.push(full);
    }
  }
  recur(absRoot);
  return out.sort();
}

export function loadJson<T = unknown>(absPath: string): T {
  return JSON.parse(readFileSync(absPath, "utf8")) as T;
}

export function loadSchema(name: string): AnySchema {
  return loadJson<AnySchema>(
    path.join(REPO_ROOT, "schemas", `${name}.schema.json`),
  );
}

export function makeAjv(): InstanceType<typeof Ajv> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv as never);
  return ajv;
}

export function relPath(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

/**
 * Deterministic JSON serialization for the `.opclib` manifest digest.
 *
 * Format: compact, object keys sorted lexicographically at every depth,
 * arrays in original order, primitive serialisation via JSON.stringify.
 * Must stay byte-identical to
 * `OpenPCB/src/modules/library/backend/sync/canonical-json.ts`. Any change
 * here MUST land in both places together — otherwise the importer rejects
 * every package built by the new packager.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) =>
      item === undefined ? "null" : canonicalize(item),
    );
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => {
        const v = obj[k];
        return (
          v !== undefined && typeof v !== "function" && typeof v !== "symbol"
        );
      })
      .sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`canonicalize: unsupported value type: ${typeof value}`);
}
