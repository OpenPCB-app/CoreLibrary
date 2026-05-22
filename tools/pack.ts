#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  packOpclib,
  type OpclibAssetEntry,
  type OpclibComponentEntry,
  type OpclibFootprintEntry,
  type OpclibModel3dEntry,
  type PackedAsset,
  type PackedComponent,
  type PackedModel3d,
  type PackOpclibInput,
} from "@openpcb/opclib-pack";
import { REPO_ROOT, relPath, sha256Bytes, walkFiles } from "./lib";

type AssetJson = {
  id: string;
  uuid: string;
  version: string;
  name: string;
};

type ComponentSourceJson = Omit<OpclibComponentEntry, "provenance"> & {
  provenance: {
    source: OpclibComponentEntry["provenance"]["source"];
    license: string;
    attribution?: string[];
    notes?: string;
  };
};

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? "true"]),
);

const version = args.version ?? "0.0.0";
const channel = (args.channel ?? "stable") as "stable" | "beta" | "nightly";
const outDir = args.out ? path.resolve(args.out) : path.join(REPO_ROOT, "dist");
const signKeyPath =
  args["sign-key"] && args["sign-key"] !== "true"
    ? path.resolve(args["sign-key"])
    : undefined;
const keyId =
  args["key-id"] && args["key-id"] !== "true" ? args["key-id"] : undefined;

if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(version)) {
  console.error(`[pack] invalid --version=${version}`);
  process.exit(1);
}

if (signKeyPath && !keyId) {
  console.error("[pack] --sign-key requires --key-id");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

function parseJsonBytes<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function readBytes(absPath: string): Uint8Array {
  return readFileSync(absPath);
}

function assetEntryFor(absPath: string, bytes: Uint8Array): OpclibAssetEntry {
  const json = parseJsonBytes<AssetJson>(bytes);
  return {
    id: json.id,
    uuid: json.uuid,
    version: json.version,
    name: json.name,
    path: relPath(absPath),
    sha256: sha256Bytes(bytes),
    license: "CC-BY-SA-4.0+OpenPCB-Library-Exception",
  };
}

function packedAssetFor(absPath: string): PackedAsset<OpclibAssetEntry> {
  const bytes = readBytes(absPath);
  return { entry: assetEntryFor(absPath, bytes), bytes };
}

function packedFootprintFor(
  absPath: string,
): PackedAsset<OpclibFootprintEntry> {
  const bytes = readBytes(absPath);
  const base = assetEntryFor(absPath, bytes);
  const json = parseJsonBytes<{
    mountType?: string;
    package?: {
      code?: string;
      standard?: string;
      imperial?: string | null;
      metric?: string | null;
    };
    models3d?: string[];
  }>(bytes);
  const packageCode =
    json.package?.code ?? json.package?.imperial ?? json.package?.metric;
  return {
    entry: {
      ...base,
      package:
        json.package || json.mountType
          ? {
              code: packageCode ?? undefined,
              standard: json.package?.standard,
              mountType: json.mountType,
            }
          : json.mountType
            ? { mountType: json.mountType }
            : undefined,
      models3d: json.models3d,
    },
    bytes,
  };
}

function packedModel3dFor(absPath: string): PackedModel3d {
  const data = parseJsonBytes<
    OpclibModel3dEntry & {
      provenance?: unknown;
      offsetMm?: unknown;
      rotationDeg?: unknown;
    }
  >(readBytes(absPath));
  const formats: OpclibModel3dEntry["formats"] = {};
  const assets: PackedModel3d["assets"] = [];
  for (const [format, info] of Object.entries(data.formats)) {
    if (!info) continue;
    if (format !== "glb" && format !== "step") {
      console.error(
        `[pack] unsupported 3D format ${format} in ${relPath(absPath)}`,
      );
      process.exit(1);
    }
    const abs = path.join(REPO_ROOT, info.path);
    if (!existsSync(abs)) {
      console.error(`[pack] missing 3D asset ${info.path}`);
      process.exit(1);
    }
    const bytes = readBytes(abs);
    formats[format] = {
      path: info.path,
      sha256: sha256Bytes(bytes),
    };
    assets.push({ format, path: info.path, bytes });
  }
  return {
    entry: {
      id: data.id,
      uuid: data.uuid,
      version: data.version,
      name: data.name,
      formats,
      boundsMm: data.boundsMm,
    },
    assets,
  };
}

function packedComponentFor(absPath: string): PackedComponent {
  const bytes = readBytes(absPath);
  const json = parseJsonBytes<ComponentSourceJson>(bytes);
  const entry: OpclibComponentEntry = {
    id: json.id,
    uuid: json.uuid,
    version: json.version,
    name: json.name,
    description: json.description,
    category: json.category,
    tags: json.tags,
    aliases: json.aliases,
    symbol: json.symbol,
    defaultFootprint: json.defaultFootprint,
    footprints: json.footprints,
    parameters: json.parameters,
    manufacturerParts: json.manufacturerParts,
    provenance: {
      source: json.provenance.source,
      license: json.provenance.license,
      attribution: json.provenance.attribution,
      notes: json.provenance.notes,
    },
    compatibility: json.compatibility,
  };
  return {
    entry,
    path: relPath(absPath),
    bytes,
  };
}

const input: PackOpclibInput = {
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
  symbols: walkFiles(path.join(REPO_ROOT, "symbols"), ".symbol.json").map(
    packedAssetFor,
  ),
  footprints: walkFiles(path.join(REPO_ROOT, "footprints"), ".fp.json").map(
    packedFootprintFor,
  ),
  models3d: walkFiles(path.join(REPO_ROOT, "3d"), ".model.json").map(
    packedModel3dFor,
  ),
  components: walkFiles(
    path.join(REPO_ROOT, "components"),
    ".component.json",
  ).map(packedComponentFor),
  sign:
    signKeyPath && keyId
      ? { privateKey: readFileSync(signKeyPath), keyId }
      : undefined,
};

const { bytes, manifest, packageSha256 } = packOpclib(input);
const outPath = path.join(outDir, `openpcb-core-library-${version}.opclib`);
writeFileSync(outPath, bytes);

console.log(
  `[pack] wrote ${outPath}\n` +
    `       symbols=${manifest.symbols.length} footprints=${manifest.footprints.length} models3d=${manifest.models3d.length} components=${manifest.components.length}\n` +
    `       packageSha256=${packageSha256}` +
    (manifest.signature
      ? `\n       signed: keyId=${manifest.signature.keyId} alg=${manifest.signature.algorithm}`
      : "\n       (unsigned)"),
);
