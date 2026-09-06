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
import { zipSync } from "fflate";
import { convertStepToGlbNode } from "@openpcb/step-to-glb/node";
import type { Model3DRef } from "@openpcb/step-to-glb";
import { REPO_ROOT, relPath, sha256Bytes, walkFiles } from "./lib";
import { computeGlbBounds, roundVec3, type ModelBounds } from "./glb-bounds";

type AssetJson = {
  id: string;
  uuid: string;
  version: string;
  name: string;
};

type ComponentSourceJson = Omit<OpclibComponentEntry, "provenance"> & {
  /** Auto-captured KiCad datasheet URL; fallback when no curated `datasheet`. */
  datasheetSource?: string | null;
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
/** When set, write computed GLB bounds back into the source `.model.json`. */
const writeBounds = args["write-bounds"] === "true";
/**
 * Exclude STEP from the archive. The app renders GLB; STEP only matters for
 * MCAD export, and it is over half the payload. The STEP files are still READ
 * (they are the GLB source) — this only drops them from the zip, and ships
 * them as a separate companion archive instead.
 */
const noStep = args["no-step"] === "true";
const STEP_TO_GLB_PARAMS = {
  linearUnit: "millimeter" as const,
  linearDeflectionType: "absolute_value" as const,
  linearDeflection: 0.05,
  angularDeflection: 0.5,
};

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

function arrayBufferFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function glbPathForStep(stepPath: string): string {
  return stepPath.replace(/\.(step|stp)$/i, ".glb");
}

const ZERO_VECTOR = { x: 0, y: 0, z: 0 };
const IDENTITY_SCALE = { x: 1, y: 1, z: 1 };

function modelRefForStep(
  stepPath: string,
  data: {
    offsetMm?: { x: number; y: number; z: number };
    rotationDeg?: { x: number; y: number; z: number };
    scaleMm?: { x: number; y: number; z: number };
  },
): Model3DRef {
  return {
    path: stepPath,
    resolvedFileName: path.basename(stepPath),
    offset: data.offsetMm ?? ZERO_VECTOR,
    rotation: data.rotationDeg ?? ZERO_VECTOR,
    scale: data.scaleMm ?? IDENTITY_SCALE,
  };
}

/**
 * STEP→GLB instantiates a fresh OCCT WebAssembly module per conversion, each
 * with its own multi-hundred-MB heap. Mapping the 3D tree with `Promise.all`
 * started all of them at once, which a dev machine absorbs but a CI runner does
 * not: past ~40 models the runner exhausts memory and Emscripten aborts with
 * "access to a null reference (evaluating 'invoker(...)')". Bounding the
 * in-flight count keeps peak memory flat as the library grows.
 *
 * Order-preserving, and the first rejection propagates (callers exit non-zero).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await fn(items[i]!);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Deliberately low. STEP→GLB is dominated by the OCCT tessellation inside each
 * WASM instance rather than by the event loop, so raising this buys no wall
 * time (139 models: 36s at 2, 37s at 4, 44s at 16) while every extra lane costs
 * another heap. A CI runner that survives one full pack has aborted with SIGILL
 * on a second one, so trade the headroom, not the speed.
 */
const MODEL_CONVERT_CONCURRENCY = Math.max(
  1,
  Number(process.env.OPCLIB_PACK_CONCURRENCY) || 2,
);

/**
 * A WASM abort kills the process outright, so a failing model cannot be caught
 * and named after the fact. Setting OPCLIB_PACK_VERBOSE (CI does) traces each
 * conversion to stderr, leaving the last line before a crash pointing at the
 * culprit.
 */
const VERBOSE = Boolean(process.env.OPCLIB_PACK_VERBOSE);

async function packedModel3dFor(absPath: string): Promise<PackedModel3d> {
  const data = parseJsonBytes<
    OpclibModel3dEntry & {
      provenance?: unknown;
      offsetMm?: { x: number; y: number; z: number };
      rotationDeg?: { x: number; y: number; z: number };
      scaleMm?: { x: number; y: number; z: number };
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

  if (!formats.glb && formats.step) {
    const stepAsset = assets.find((asset) => asset.format === "step");
    if (!stepAsset) {
      console.error(
        `[pack] cannot generate GLB for ${relPath(absPath)}: missing STEP asset`,
      );
      process.exit(1);
    }
    if (VERBOSE) {
      console.error(`[pack] STEP→GLB ${formats.step.path}`);
    }
    const result = await convertStepToGlbNode(
      arrayBufferFrom(stepAsset.bytes),
      STEP_TO_GLB_PARAMS,
      modelRefForStep(formats.step.path, data),
      { axisCorrection: "none" },
    );
    if (result.status !== "ok") {
      console.error(
        `[pack] STEP→GLB failed for ${relPath(absPath)}: ${result.message}`,
      );
      process.exit(1);
    }
    const bytes = new Uint8Array(result.glbBytes);
    const glbPath = glbPathForStep(formats.step.path);
    const glbSha256 = sha256Bytes(bytes);
    formats.glb = { path: glbPath, sha256: glbSha256 };
    assets.push({ format: "glb", path: glbPath, bytes });
  }

  // Measure the baked GLB so the manifest carries an extent and (optionally) the
  // sidecar gains committed bounds used by the orientation gate.
  let bounds: ModelBounds | undefined;
  const glbAsset = assets.find((asset) => asset.format === "glb");
  if (glbAsset) {
    bounds = await computeGlbBounds(glbAsset.bytes);
    if (writeBounds) {
      patchSidecarBounds(absPath, bounds);
    }
  }

  // Drop STEP only AFTER it has served as the GLB source and the bounds are
  // measured, so a --no-step pack is byte-identical to a full one minus the
  // STEP entries.
  const packedFormats = { ...formats };
  const packedAssets = noStep
    ? assets.filter((asset) => asset.format !== "step")
    : assets;
  if (noStep) delete packedFormats.step;

  return {
    entry: {
      id: data.id,
      uuid: data.uuid,
      version: data.version,
      name: data.name,
      formats: packedFormats,
      boundsMm: bounds ? roundVec3(bounds.size) : data.boundsMm,
      offsetMm: data.offsetMm,
      rotationDeg: data.rotationDeg,
      scaleMm: data.scaleMm,
      transformBaked: Boolean(packedFormats.glb),
    },
    assets: packedAssets,
  };
}

/** Write computed bounds into a source `.model.json`, preserving the rest. */
function patchSidecarBounds(absPath: string, bounds: ModelBounds): void {
  const json = JSON.parse(readFileSync(absPath, "utf8")) as Record<
    string,
    unknown
  >;
  json.boundsMm = roundVec3(bounds.size);
  json.boundsMinMm = roundVec3(bounds.min);
  json.boundsMaxMm = roundVec3(bounds.max);
  writeFileSync(absPath, `${JSON.stringify(json, null, 2)}\n`);
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
    subcategory: json.subcategory,
    datasheet: json.datasheet ?? json.datasheetSource ?? null,
    keywords: json.keywords,
    tags: json.tags,
    aliases: json.aliases,
    symbol: json.symbol,
    defaultFootprint: json.defaultFootprint,
    footprints: json.footprints,
    parameters: json.parameters,
    manufacturerParts: packManufacturerParts(json.manufacturerParts),
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
  models3d: await mapWithConcurrency(
    walkFiles(path.join(REPO_ROOT, "3d"), ".model.json"),
    MODEL_CONVERT_CONCURRENCY,
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

// STEP companion. Not an .opclib — a STEP-only archive carries no symbols,
// footprints or components and so could never satisfy the library manifest
// schema. A plain zip keyed on the same repo-relative paths is what an MCAD
// consumer actually wants.
if (noStep) {
  const stepFiles = walkFiles(path.join(REPO_ROOT, "3d"), ".step");
  const entries: Record<string, Uint8Array> = {};
  const digests: string[] = [];
  for (const abs of stepFiles) {
    const rel = relPath(abs);
    const bytes = readBytes(abs);
    entries[rel] = bytes;
    digests.push(`${sha256Bytes(bytes)}  ${rel}`);
  }
  entries["SHA256SUMS"] = new TextEncoder().encode(`${digests.join("\n")}\n`);

  const stepZip = zipSync(entries, { level: 9 });
  const stepPath = path.join(
    outDir,
    `openpcb-core-library-${version}-step.zip`,
  );
  writeFileSync(stepPath, stepZip);
  console.log(
    `[pack] wrote ${stepPath}\n       ${stepFiles.length} STEP model(s) + SHA256SUMS`,
  );
}

/**
 * The packed manifest schema (`@openpcb/opclib-pack` library.schema.json)
 * admits only `{manufacturer, mpn}` per entry. Source JSON carries richer
 * sourcing data (`lcsc`, `jlcpcbAssemblyType`, `package`, `role`); strip it
 * here rather than bump the pack schema. Order is preserved: entry 0 stays
 * the primary the desktop app reads.
 */
function packManufacturerParts(
  entries: Array<{ manufacturer: string; mpn: string }> | undefined,
): Array<{ manufacturer: string; mpn: string }> | undefined {
  if (!entries) return undefined;
  return entries.map(({ manufacturer, mpn }) => ({ manufacturer, mpn }));
}
