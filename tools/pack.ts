#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import {
  REPO_ROOT,
  canonicalize,
  loadJson,
  loadSchema,
  makeAjv,
  relPath,
  sha256Bytes,
  sha256File,
  walkFiles,
} from "./lib";
import type {
  AssetEntry,
  ComponentEntry,
  FootprintEntry,
  LibraryManifest,
  Model3dEntry,
} from "./types";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? "true"]),
);

const version = args.version ?? "0.0.0";
const channel = (args.channel ?? "stable") as "stable" | "beta" | "nightly";
const outDir = args.out ? path.resolve(args.out) : path.join(REPO_ROOT, "dist");

if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
  console.error(`[pack] invalid --version=${version}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

function entryFor(absPath: string): AssetEntry {
  const json = loadJson<{
    id: string;
    uuid: string;
    version: string;
    name: string;
  }>(absPath);
  return {
    id: json.id,
    uuid: json.uuid,
    version: json.version,
    name: json.name,
    path: relPath(absPath),
    sha256: sha256File(absPath),
    license: "CC-BY-SA-4.0+OpenPCB-Library-Exception",
  };
}

const symbols: AssetEntry[] = walkFiles(
  path.join(REPO_ROOT, "symbols"),
  ".symbol.json",
).map(entryFor);

const footprints: FootprintEntry[] = walkFiles(
  path.join(REPO_ROOT, "footprints"),
  ".fp.json",
).map((file) => {
  const base = entryFor(file);
  const json = loadJson<{
    mountType?: string;
    package?: { code?: string; standard?: string };
    models3d?: string[];
  }>(file);
  return {
    ...base,
    package: json.package
      ? { ...json.package, mountType: json.mountType }
      : json.mountType
        ? { mountType: json.mountType }
        : undefined,
    models3d: json.models3d,
  };
});

const models3d: Model3dEntry[] = walkFiles(
  path.join(REPO_ROOT, "3d"),
  ".model.json",
).map((file) => {
  const data = loadJson<Model3dEntry>(file);
  // Re-stamp sha256s of binary assets relative to repo root.
  const formats: Model3dEntry["formats"] = {};
  for (const [fmt, info] of Object.entries(data.formats)) {
    const abs = path.join(REPO_ROOT, info.path);
    if (!existsSync(abs)) {
      console.error(`[pack] missing 3D asset ${info.path}`);
      process.exit(1);
    }
    (formats as Record<string, { path: string; sha256: string }>)[fmt] = {
      path: info.path,
      sha256: sha256File(abs),
    };
  }
  return { ...data, formats };
});

const components: ComponentEntry[] = walkFiles(
  path.join(REPO_ROOT, "components"),
  ".component.json",
).map((file) => loadJson<ComponentEntry>(file));

const manifest: LibraryManifest = {
  schemaVersion: "1.0.0",
  library: {
    id: "openpcb.core",
    name: "OpenPCB Core Library",
    kind: "core",
    channel,
    version,
    license: "CC-BY-SA-4.0+OpenPCB-Library-Exception",
    homepage: "https://openpcb.app/libraries/core",
    generatedAt: new Date().toISOString(),
  },
  symbols,
  footprints,
  models3d,
  components,
  integrity: { algorithm: "sha256", packageSha256: "" },
};

// Validate manifest against library schema.
const ajv = makeAjv();
const validateLibrary = ajv.compile(loadSchema("library"));
// Temporarily fill packageSha256 with a dummy 64-char string so the manifest
// passes the integrity schema; the real digest is computed below.
manifest.integrity.packageSha256 = "0".repeat(64);
if (!validateLibrary(manifest)) {
  console.error("[pack] manifest failed schema validation:");
  for (const err of validateLibrary.errors ?? [])
    console.error(`  ${err.instancePath} ${err.message}`);
  process.exit(1);
}

// Build zip payload: every referenced file + the manifest itself.
const payload: Zippable = {};

function addToZip(repoRelPath: string) {
  const abs = path.join(REPO_ROOT, repoRelPath);
  payload[repoRelPath] = readFileSync(abs);
}

for (const e of symbols) addToZip(e.path);
for (const e of footprints) addToZip(e.path);
// Component entries in the manifest don't carry file paths (only id/uuid/
// version/etc). Re-derive the on-disk paths by walking the source tree so
// they round-trip into the package.
for (const file of walkFiles(
  path.join(REPO_ROOT, "components"),
  ".component.json",
)) {
  addToZip(relPath(file));
}
for (const model of models3d) {
  for (const info of Object.values(model.formats)) {
    if (info) addToZip(info.path);
  }
}

// Stable manifest digest: zero packageSha256, canonicalise, hash, write back.
// `canonicalize` produces sorted-key compact JSON — byte-deterministic across
// runtimes. Reader uses the same algorithm to recompute.
manifest.integrity.packageSha256 = "0".repeat(64);
const packageHash = sha256Bytes(
  new TextEncoder().encode(canonicalize(manifest)),
);
manifest.integrity.packageSha256 = packageHash;

// The on-disk manifest is human-readable (pretty-printed); only the digest
// uses the canonical form. The reader re-canonicalises before hashing.
const finalManifestBytes = new TextEncoder().encode(
  JSON.stringify(manifest, null, 2),
);
payload["library.json"] = finalManifestBytes;

const zipped = zipSync(payload, { level: 6 });
const outPath = path.join(outDir, `openpcb-core-library-${version}.opclib`);
writeFileSync(outPath, zipped);

console.log(
  `[pack] wrote ${outPath}\n` +
    `       symbols=${symbols.length} footprints=${footprints.length} models3d=${models3d.length} components=${components.length}\n` +
    `       packageSha256=${packageHash}`,
);
