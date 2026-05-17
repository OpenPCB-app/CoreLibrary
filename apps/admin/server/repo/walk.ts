import { readdirSync, statSync } from "node:fs";
import path from "node:path";

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

export function categoryFromPath(absPath: string, rootDir: string): string {
  const rel = path.relative(rootDir, absPath).split(path.sep);
  return rel.length > 1 && rel[0] ? rel[0] : "uncategorized";
}
