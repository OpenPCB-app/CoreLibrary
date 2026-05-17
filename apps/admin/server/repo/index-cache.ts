import { readFileSync, watch, existsSync } from "node:fs";
import path from "node:path";
import {
  COMPONENTS_DIR,
  FOOTPRINTS_DIR,
  MODELS_DIR,
  SYMBOLS_DIR,
} from "./paths";
import type {
  ComponentFile,
  FootprintFile,
  IndexedComponent,
  IndexedFootprint,
  IndexedSymbol,
  Model3dEntry,
  SymbolFile,
} from "./types";
import { categoryFromPath, walkFiles } from "./walk";

interface Index {
  components: Map<string, IndexedComponent>;
  symbols: Map<string, IndexedSymbol>;
  footprints: Map<string, IndexedFootprint>;
  models: Map<string, Model3dEntry>;
  builtAt: number;
}

let cache: Index | null = null;
const listeners = new Set<() => void>();

function loadJson<T>(absPath: string): T | null {
  try {
    return JSON.parse(readFileSync(absPath, "utf8")) as T;
  } catch (err) {
    console.warn(`[repo] skipping ${absPath}: ${(err as Error).message}`);
    return null;
  }
}

function buildIndex(): Index {
  const components = new Map<string, IndexedComponent>();
  const symbols = new Map<string, IndexedSymbol>();
  const footprints = new Map<string, IndexedFootprint>();
  const models = new Map<string, Model3dEntry>();

  for (const absPath of walkFiles(SYMBOLS_DIR, ".symbol.json")) {
    const file = loadJson<SymbolFile>(absPath);
    if (!file || !file.id) continue;
    symbols.set(file.id, {
      file,
      absPath,
      category: categoryFromPath(absPath, SYMBOLS_DIR),
    });
  }
  for (const absPath of walkFiles(FOOTPRINTS_DIR, ".fp.json")) {
    const file = loadJson<FootprintFile>(absPath);
    if (!file || !file.id) continue;
    footprints.set(file.id, {
      file,
      absPath,
      category: categoryFromPath(absPath, FOOTPRINTS_DIR),
    });
  }
  for (const absPath of walkFiles(COMPONENTS_DIR, ".component.json")) {
    const file = loadJson<ComponentFile>(absPath);
    if (!file || !file.id) continue;
    components.set(file.id, {
      file,
      absPath,
      category: file.category ?? categoryFromPath(absPath, COMPONENTS_DIR),
    });
  }
  for (const absPath of walkFiles(MODELS_DIR, ".glb")) {
    const slug = path.basename(absPath, ".glb");
    const category = categoryFromPath(absPath, MODELS_DIR);
    const key = `${category}/${slug}`;
    const referencedBy: string[] = [];
    for (const fp of footprints.values()) {
      const refs = fp.file.models3d ?? [];
      if (refs.some((r) => r.includes(slug))) referencedBy.push(fp.file.id);
    }
    models.set(key, {
      slug,
      category,
      glbAbsPath: absPath,
      glbRelPath: path.relative(MODELS_DIR, absPath),
      referencedBy,
    });
  }

  return { components, symbols, footprints, models, builtAt: Date.now() };
}

export function getIndex(): Index {
  if (!cache) cache = buildIndex();
  return cache;
}

export function rebuildIndex(): Index {
  cache = buildIndex();
  for (const l of listeners) l();
  return cache;
}

export function subscribeIndex(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let watchersInstalled = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function installWatchers(): void {
  if (watchersInstalled) return;
  watchersInstalled = true;
  const dirs = [SYMBOLS_DIR, FOOTPRINTS_DIR, COMPONENTS_DIR, MODELS_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      watch(dir, { recursive: true }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          rebuildIndex();
        }, 150);
      });
    } catch (err) {
      console.warn(`[repo] watch ${dir} failed: ${(err as Error).message}`);
    }
  }
}
