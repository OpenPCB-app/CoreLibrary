import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import Ajv, { type AnySchema } from "ajv/dist/2020";
import addFormats from "ajv-formats";
export { canonicalize, sha256Bytes, sha256File } from "@openpcb/opclib-pack";

export const REPO_ROOT = path.resolve(import.meta.dir, "..");
export const ID_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

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
