#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  parseKicadFootprint,
  parseKicadSymbolLib,
  type ParsedKicadFootprint,
  type ParsedKicadSymbol,
} from "@openpcb/kicad-parsers";
import {
  buildFootprintPreviewFromParsed,
  buildSymbolPreviewFromParsed,
  extractPackageCode,
  validateFootprintPads,
  type NormalizedImportedFootprint,
  type NormalizedImportedSymbol,
} from "@openpcb/kicad-import";
import {
  ID_REGEX,
  REPO_ROOT,
  SEMVER_REGEX,
  packageCodeFor,
  sha256File,
} from "./lib";

const LICENSE = "CC-BY-SA-4.0+KiCad-Libraries-Exception";
const TOOL = "CoreLibrary tools/import-kicad-batch.ts";
// Pinned KiCad official-libraries checkout, vendored at ../references/kicad-libs (KiCad 10.0.4).
const KICAD_UPSTREAM_URL = "https://gitlab.com/kicad/libraries";
const KICAD_UPSTREAM_COMMIT = "c7e226a49";
const DEFAULT_KICAD_ROOT = path.resolve(
  REPO_ROOT,
  "..",
  "references",
  "kicad-libs",
);

interface PinMapEntry {
  pinNumber: string;
  padNumber: string;
  pinName?: string;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface ManifestModel {
  id: string;
  path: string;
  /** Sidecar transform overrides — declared here so hand-tuned placement
   * fixes (e.g. the DIP/connector scaleMm.y:-1 mirror) survive re-imports
   * with --allow-overwrite instead of being clobbered to KiCad defaults. */
  offsetMm?: Vec3Like;
  rotationDeg?: Vec3Like;
  scaleMm?: Vec3Like;
}

interface ManifestFootprint {
  id: string;
  /** KiCad source path. Absent when `existing` — the asset is already in the library. */
  path?: string;
  label: string;
  /** Reference an already-imported footprint asset by id without re-importing
   * (footprints are shared package-oriented assets). No writes happen for this
   * entry; pads for pinMap validation load from the on-disk fp sidecar. */
  existing?: boolean;
  /** Required unless `no3d` — the footprint's STEP-backed 3D model. */
  model?: ManifestModel;
  /** Posture override for the 3D orientation gate when the KiCad footprint
   * name lacks _Vertical/_Horizontal (e.g. DHT11 stands vertical). */
  orientationHint?: "vertical" | "horizontal";
  /** THT lead budget override (mm below board) for STEPs with full uncut leads. */
  belowBoardBudgetMm?: number;
  /**
   * Footprint legitimately ships without a 3D model (mechanical parts like
   * MountingHole/Fiducial that have no upstream STEP, or asm-only electrical
   * parts whose STEP is unavailable). Suppresses the model lookup/write and
   * exempts the footprint from the release STEP gate. Keep to genuine gaps.
   */
  no3d?: boolean;
  pinMap?: PinMapEntry[];
}

interface ManifestSymbol {
  id: string;
  path: string;
  /** Symbol legitimately has no pins (mechanical: mounting holes, fiducials,
   * logos). Opt-in so the "no parsed pins" safety net still catches real parse
   * failures on electrical symbols. */
  pinless?: boolean;
}

interface ManufacturerPart {
  manufacturer: string;
  mpn: string;
  datasheet?: string;
  lcsc?: string;
  jlcpcbAssemblyType?: string;
  lifecycle?: string;
  rohs?: boolean | null;
  role?: string;
  package?: string;
}

interface ManifestComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  keywords?: string[];
  aliases?: string[];
  datasheet?: string | null;
  datasheetSource?: string;
  parameters?: Record<string, unknown>;
  manufacturerParts?: ManufacturerPart[];
  symbol: ManifestSymbol;
  defaultFootprint: string;
  footprints: ManifestFootprint[];
  compatibility?: { minOpenPcbVersion?: string };
}

interface ImportManifest {
  version: string;
  components: ManifestComponent[];
}

interface Args {
  manifest: string;
  kicadRoot: string;
  out: string;
  dryRun: boolean;
  strict: boolean;
  allowOverwrite: boolean;
  convertedAt: string;
}

interface ResolvedSymbol {
  source: string;
  parsed: ParsedKicadSymbol;
  normalized: NormalizedImportedSymbol;
  hash: string;
  sourceFiles: Array<{
    fileName: string;
    sourceItemName: string;
    sha256: string;
  }>;
}

interface ResolvedFootprint {
  source: string;
  parsed: ParsedKicadFootprint;
  normalized: NormalizedImportedFootprint;
  hash: string;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const allowedValues = new Set([
    "manifest",
    "kicad-root",
    "out",
    "converted-at",
  ]);
  const allowedFlags = new Set(["dry-run", "strict", "allow-overwrite"]);
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`Invalid argument: ${arg}`);
    if (arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      if (!key) throw new Error(`Invalid argument: ${arg}`);
      if (!allowedValues.has(key))
        throw new Error(`Unknown argument: --${key}`);
      values.set(key, rest.join("="));
    } else {
      const flag = arg.slice(2);
      if (!allowedFlags.has(flag)) throw new Error(`Unknown flag: --${flag}`);
      flags.add(flag);
    }
  }

  const manifest = values.get("manifest");
  if (!manifest) throw new Error("--manifest is required");
  const out = values.get("out") ?? REPO_ROOT;
  const kicadRoot = values.get("kicad-root") ?? DEFAULT_KICAD_ROOT;
  const convertedAt = values.get("converted-at") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(convertedAt)))
    throw new Error("--converted-at must be an ISO date-time");
  return {
    manifest: path.resolve(manifest),
    out: path.resolve(out),
    kicadRoot: path.resolve(kicadRoot),
    dryRun: flags.has("dry-run"),
    strict: flags.has("strict"),
    allowOverwrite: flags.has("allow-overwrite"),
    convertedAt,
  };
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function stableId(prefix: string, entropy: string): string {
  return `${prefix}_${sha256(entropy).slice(0, 16)}`;
}

function uuidFromSeed(seed: string): string {
  const hex = sha256(seed);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${pathName} must be a non-empty string`);
  return value;
}

function requireId(value: unknown, pathName: string): string {
  const id = requireString(value, pathName);
  if (!ID_REGEX.test(id))
    throw new Error(`${pathName} must be a valid OpenPCB id`);
  return id;
}

function requireSourcePath(
  value: unknown,
  pathName: string,
  suffix: string,
): string {
  const source = requireString(value, pathName);
  if (!source.endsWith(suffix))
    throw new Error(`${pathName} must end with ${suffix}`);
  return source;
}

function optionalStringArray(
  value: unknown,
  pathName: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${pathName} must be an array of strings`);
  return value;
}

function requireStringArray(value: unknown, pathName: string): string[] {
  const array = optionalStringArray(value, pathName);
  if (!array) throw new Error(`${pathName} is required`);
  return array;
}

function optionalString(value: unknown, pathName: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, pathName);
}

function optionalNullableString(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireString(value, pathName);
}

function optionalParameters(
  value: unknown,
  pathName: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  return value;
}

function optionalManufacturerParts(
  value: unknown,
  pathName: string,
): ManufacturerPart[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${pathName} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item))
      throw new Error(`${pathName}[${index}] must be an object`);
    requireString(item.manufacturer, `${pathName}[${index}].manufacturer`);
    requireString(item.mpn, `${pathName}[${index}].mpn`);
    return item as unknown as ManufacturerPart;
  });
}

function readPinMap(
  value: unknown,
  pathName: string,
): PinMapEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${pathName} must be an array`);
  return value.map((item, index) => {
    if (!isObject(item))
      throw new Error(`${pathName}[${index}] must be an object`);
    const entry: PinMapEntry = {
      pinNumber: requireString(
        item.pinNumber,
        `${pathName}[${index}].pinNumber`,
      ),
      padNumber: requireString(
        item.padNumber,
        `${pathName}[${index}].padNumber`,
      ),
    };
    if (item.pinName !== undefined)
      entry.pinName = requireString(
        item.pinName,
        `${pathName}[${index}].pinName`,
      );
    return entry;
  });
}

function readVec3(value: unknown, pathName: string): Vec3Like | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  const { x, y, z } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number"
  )
    throw new Error(`${pathName} must have numeric x/y/z`);
  return { x, y, z };
}

function readManifestModel(value: unknown, pathName: string): ManifestModel {
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  return {
    id: requireId(value.id, `${pathName}.id`),
    path: requireSourcePath(value.path, `${pathName}.path`, ".step"),
    offsetMm: readVec3(value.offsetMm, `${pathName}.offsetMm`),
    rotationDeg: readVec3(value.rotationDeg, `${pathName}.rotationDeg`),
    scaleMm: readVec3(value.scaleMm, `${pathName}.scaleMm`),
  };
}

function readManifestFootprint(
  value: unknown,
  pathName: string,
): ManifestFootprint {
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  if (value.existing === true) {
    for (const forbidden of ["path", "model", "no3d", "orientationHint", "belowBoardBudgetMm"])
      if (value[forbidden] !== undefined)
        throw new Error(
          `${pathName}: an existing footprint reference must not declare ${forbidden}`,
        );
    return {
      id: requireId(value.id, `${pathName}.id`),
      label: requireString(value.label, `${pathName}.label`),
      existing: true,
      pinMap: readPinMap(value.pinMap, `${pathName}.pinMap`),
    };
  }
  const footprint: ManifestFootprint = {
    id: requireId(value.id, `${pathName}.id`),
    path: requireSourcePath(value.path, `${pathName}.path`, ".kicad_mod"),
    label: requireString(value.label, `${pathName}.label`),
    pinMap: readPinMap(value.pinMap, `${pathName}.pinMap`),
  };
  if (value.no3d === true) {
    footprint.no3d = true;
    if (value.model !== undefined)
      throw new Error(`${pathName}: a no3d footprint must not declare a model`);
  } else {
    footprint.model = readManifestModel(value.model, `${pathName}.model`);
  }
  if (value.orientationHint !== undefined) {
    if (value.orientationHint !== "vertical" && value.orientationHint !== "horizontal")
      throw new Error(`${pathName}.orientationHint must be "vertical" or "horizontal"`);
    footprint.orientationHint = value.orientationHint;
  }
  if (value.belowBoardBudgetMm !== undefined) {
    if (typeof value.belowBoardBudgetMm !== "number" || value.belowBoardBudgetMm <= 0)
      throw new Error(`${pathName}.belowBoardBudgetMm must be a positive number`);
    footprint.belowBoardBudgetMm = value.belowBoardBudgetMm;
  }
  return footprint;
}

function readManifestComponent(
  value: unknown,
  pathName: string,
): ManifestComponent {
  if (!isObject(value)) throw new Error(`${pathName} must be an object`);
  const symbolValue = value.symbol;
  if (!isObject(symbolValue))
    throw new Error(`${pathName}.symbol must be an object`);
  const footprintsValue = value.footprints;
  if (!Array.isArray(footprintsValue) || footprintsValue.length === 0)
    throw new Error(`${pathName}.footprints must be a non-empty array`);
  const compatibilityValue = value.compatibility;
  const compatibility = isObject(compatibilityValue)
    ? {
        minOpenPcbVersion:
          typeof compatibilityValue.minOpenPcbVersion === "string"
            ? compatibilityValue.minOpenPcbVersion
            : undefined,
      }
    : undefined;
  return {
    id: requireId(value.id, `${pathName}.id`),
    name: requireString(value.name, `${pathName}.name`),
    description: requireString(value.description, `${pathName}.description`),
    category: requireString(value.category, `${pathName}.category`),
    subcategory: optionalString(value.subcategory, `${pathName}.subcategory`),
    tags: requireStringArray(value.tags, `${pathName}.tags`),
    keywords: optionalStringArray(value.keywords, `${pathName}.keywords`),
    aliases: optionalStringArray(value.aliases, `${pathName}.aliases`),
    datasheet: optionalNullableString(value.datasheet, `${pathName}.datasheet`),
    datasheetSource: optionalString(
      value.datasheetSource,
      `${pathName}.datasheetSource`,
    ),
    parameters: optionalParameters(value.parameters, `${pathName}.parameters`),
    manufacturerParts: optionalManufacturerParts(
      value.manufacturerParts,
      `${pathName}.manufacturerParts`,
    ),
    symbol: {
      id: requireId(symbolValue.id, `${pathName}.symbol.id`),
      path: requireSourcePath(
        symbolValue.path,
        `${pathName}.symbol.path`,
        ".kicad_sym",
      ),
      ...(symbolValue.pinless === true ? { pinless: true } : {}),
    },
    defaultFootprint: requireId(
      value.defaultFootprint,
      `${pathName}.defaultFootprint`,
    ),
    footprints: footprintsValue.map((item, index) =>
      readManifestFootprint(item, `${pathName}.footprints[${index}]`),
    ),
    compatibility,
  };
}

async function loadManifest(file: string): Promise<ImportManifest> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!isObject(raw)) throw new Error("manifest must be an object");
  const componentsValue = raw.components;
  if (!Array.isArray(componentsValue) || componentsValue.length === 0)
    throw new Error("manifest.components must be a non-empty array");
  return {
    version: requireString(raw.version, "manifest.version"),
    components: componentsValue.map((item, index) =>
      readManifestComponent(item, `manifest.components[${index}]`),
    ),
  };
}

function validateManifestShape(manifest: ImportManifest): void {
  if (!SEMVER_REGEX.test(manifest.version))
    throw new Error("manifest.version must be semver");
  const componentIds = new Set<string>();
  const symbolIds = new Map<string, string>();
  const footprintIds = new Map<string, string>();
  const modelIds = new Map<string, string>();
  for (const component of manifest.components) {
    if (componentIds.has(component.id))
      throw new Error(`duplicate component id: ${component.id}`);
    componentIds.add(component.id);
    const componentCategory = idPart(component.id, "openpcb.core.").category;
    if (componentCategory !== component.category)
      throw new Error(
        `${component.id} category mismatch: id has ${componentCategory}, component has ${component.category}`,
      );
    rememberId(symbolIds, component.symbol.id, component.symbol.path, "symbol");
    const footprintIdsForComponent = new Set<string>();
    for (const footprint of component.footprints) {
      footprintIdsForComponent.add(footprint.id);
      rememberId(
        footprintIds,
        footprint.id,
        footprint.path ?? "<existing>",
        "footprint",
      );
      if (footprint.model)
        rememberId(modelIds, footprint.model.id, footprint.model.path, "model");
    }
    if (!footprintIdsForComponent.has(component.defaultFootprint))
      throw new Error(
        `${component.id} defaultFootprint is not in manifest footprints[]`,
      );
  }
}

function rememberId(
  ids: Map<string, string>,
  id: string,
  source: string,
  kind: string,
): void {
  const hit = ids.get(id);
  if (hit && hit !== source)
    throw new Error(
      `${kind} id collision: ${id} maps to both ${hit} and ${source}`,
    );
  ids.set(id, source);
}

function sourcePath(kicadRoot: string, source: string): string {
  return path.isAbsolute(source) ? source : path.join(kicadRoot, source);
}

function idPart(
  id: string,
  prefix: string,
): { category: string; slug: string } {
  if (!id.startsWith(prefix))
    throw new Error(`${id} must start with ${prefix}`);
  const rest = id.slice(prefix.length);
  const parts = rest.split(".");
  if (parts.length < 2) throw new Error(`${id} must include category and slug`);
  return { category: parts[0]!, slug: parts.slice(1).join("-") };
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function provenance(
  format: string,
  sourcePathValue: string,
  item: string,
  hash: string,
  convertedAt: string,
) {
  const parent = path
    .basename(path.dirname(sourcePathValue))
    .replace(/\.(kicad_symdir|pretty|3dshapes)$/, "");
  return {
    source: "kicad-derived",
    license: LICENSE,
    attribution: ["Derived from KiCad official libraries."],
    sourceFormat: format,
    sourceFileName: path.basename(sourcePathValue),
    sourceLibrary: parent,
    sourceItemName: item,
    sourceHash: hash,
    upstreamUrl: KICAD_UPSTREAM_URL,
    upstreamCommit: KICAD_UPSTREAM_COMMIT,
    convertedAt,
    conversionTool: TOOL,
  };
}

function normalizeSymbol(
  symbol: ParsedKicadSymbol,
  sourceHash: string,
): NormalizedImportedSymbol {
  const preview = buildSymbolPreviewFromParsed(symbol);
  const referencePrefix = (symbol.properties.Reference ?? symbol.name)
    .replace(/[^A-Za-z#]/g, "")
    .slice(0, 8);

  // The app wires from `normalized.pins`, not from the preview, so the two must
  // agree. KiCad draws every unit of a multi-unit symbol at the SAME local
  // coordinates and the preview builder spreads them apart — copying
  // `pin.position` verbatim here would leave the electrical pins coincident and
  // short every unit together (all four LM324 outputs onto one net).
  const anchorByKey = new Map(preview.pins.map((p) => [p.id, p.anchor]));

  return {
    id: stableId("sym", `${sourceHash}:${symbol.name}`),
    name: symbol.name,
    referencePrefix: referencePrefix.length > 0 ? referencePrefix : "U",
    description: symbol.properties.Description ?? null,
    sourceHash,
    pins: symbol.pins.map((pin, index) => {
      const originPinKey =
        pin.number.trim().length > 0
          ? `u${pin.unit}:${pin.number}`
          : `u${pin.unit}:idx${index + 1}`;
      const anchor = anchorByKey.get(originPinKey);
      if (!anchor && !pin.hidden) {
        throw new Error(
          `symbol ${symbol.name}: visible pin ${originPinKey} has no preview anchor — preview and pins are out of sync`,
        );
      }
      return {
        originPinKey,
        number: pin.number.trim().length > 0 ? pin.number : null,
        name: pin.name,
        // Hidden pins are excluded from the preview (includeHiddenPins:false),
        // so they keep their source coordinate. Any collision that introduces
        // is caught by the cross-unit gate in validate.ts.
        localPosition: anchor
          ? { x: anchor.x, y: anchor.y }
          : { x: pin.position.x, y: pin.position.y },
        electricalType: pin.electricalType,
        unit: pin.unit,
      };
    }),
    warnings: preview.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    preview,
  };
}

function dedupeSymbolPins(symbol: ParsedKicadSymbol): ParsedKicadSymbol {
  const seen = new Set<string>();
  const pins = symbol.pins.filter((pin, index) => {
    const key =
      pin.number.trim().length > 0 ? pin.number : `${pin.unit}:idx${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return pins.length === symbol.pins.length ? symbol : { ...symbol, pins };
}

/** KiCad mechanical parts (mounting holes, fiducials) often carry no smd/tht
 * attr — derive from pad geometry: any drilled pad → through_hole, else smd. */
function deriveMountType(footprint: ParsedKicadFootprint): string {
  const attr = footprint.attributes.type;
  if (attr === "smd" && hasStrayThroughHolePad(footprint)) return "mixed";
  if (attr === "smd" || attr === "through_hole") return attr;
  const drilled = footprint.pads.some(
    (pad) => pad.type === "thru_hole" || pad.type === "np_thru_hole",
  );
  return drilled ? "through_hole" : "smd";
}

/**
 * A KiCad `smd` footprint with a numbered plated hole whose number is not
 * also carried by an SMD pad (thermal vias share the EP number) is really a
 * mixed-technology part — THT shield tabs on an SMD connector, for example.
 */
function hasStrayThroughHolePad(footprint: ParsedKicadFootprint): boolean {
  const smdNumbers = new Set(
    footprint.pads
      .filter((pad) => pad.type === "smd")
      .map((pad) => (pad.number ?? "").trim()),
  );
  return footprint.pads.some((pad) => {
    const number = (pad.number ?? "").trim();
    return pad.type === "thru_hole" && number !== "" && !smdNumbers.has(number);
  });
}

function normalizeFootprint(
  footprint: ParsedKicadFootprint,
  sourceHash: string,
  fileName: string,
): NormalizedImportedFootprint {
  const preview = buildFootprintPreviewFromParsed(footprint);
  const pkg = extractPackageCode(footprint.name);
  const mountType = deriveMountType(footprint);
  return {
    id: stableId("fp", `${sourceHash}:${fileName}:${footprint.name}`),
    fileName,
    name: footprint.name,
    description: footprint.description,
    mountType,
    padCount: footprint.pads.length,
    // `code` was previously dropped, which left package.code undefined for
    // every footprint in the packed manifest (pack.ts prefers it over the
    // imperial/metric fallbacks). extractPackageCode echoes the footprint name
    // when it recognizes nothing, so only persist a code that means something.
    packageCode: packageCodeFor(footprint.name),
    tags: uniqueTags([
      ...footprint.tags,
      mountType,
      pkg.imperial ?? "",
      pkg.metric ?? "",
    ]),
    sourceHash,
    warnings: preview.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
    })),
    preview,
  };
}

function extendsName(source: string): string | null {
  const match = source.match(/\(extends\s+"([^"]+)"\)/);
  return match?.[1] ?? null;
}

interface ParsedSymbolWithSources {
  parsed: ParsedKicadSymbol;
  sources: Array<{ file: string; sourceItemName: string; sha256: string }>;
}

async function parseSymbolWithInheritance(
  file: string,
  seen = new Set<string>(),
): Promise<ParsedSymbolWithSources> {
  if (seen.has(file))
    throw new Error(`cyclic KiCad symbol inheritance at ${file}`);
  seen.add(file);
  const source = await readFile(file, "utf8");
  const sourceHash = sha256(source);
  const parsed = parseKicadSymbolLib(source).symbols[0];
  if (!parsed) throw new Error(`no symbol found in ${file}`);
  const dedupedParsed = dedupeSymbolPins(parsed);
  const ownSource = { file, sourceItemName: parsed.name, sha256: sourceHash };
  if (dedupedParsed.pins.length > 0)
    return { parsed: dedupedParsed, sources: [ownSource] };

  const parentName = extendsName(source);
  if (!parentName) return { parsed: dedupedParsed, sources: [ownSource] };
  const parentFile = path.join(path.dirname(file), `${parentName}.kicad_sym`);
  if (!existsSync(parentFile))
    return { parsed: dedupedParsed, sources: [ownSource] };
  const parent = await parseSymbolWithInheritance(parentFile, seen);
  return {
    parsed: dedupeSymbolPins({
      ...parent.parsed,
      name: parsed.name,
      kicadId: parsed.kicadId,
      properties: { ...parent.parsed.properties, ...parsed.properties },
      rawSource: parsed.rawSource,
      warnings: [
        ...parent.parsed.warnings,
        ...parsed.warnings,
        {
          code: "symbol_extends_resolved",
          message: `Resolved pins from ${parentName}`,
        },
      ],
    }),
    sources: [ownSource, ...parent.sources],
  };
}

async function resolveSymbol(
  kicadRoot: string,
  manifestSymbol: ManifestSymbol,
): Promise<ResolvedSymbol> {
  const source = sourcePath(kicadRoot, manifestSymbol.path);
  if (!existsSync(source)) throw new Error(`missing symbol source: ${source}`);
  const inherited = await parseSymbolWithInheritance(source);
  const parsed = inherited.parsed;
  if (parsed.pins.length === 0 && !manifestSymbol.pinless)
    throw new Error(
      `symbol has no parsed pins: ${source} (set symbol.pinless:true if this is intentional, e.g. a mounting hole/fiducial)`,
    );
  const hash = sha256(
    inherited.sources.map((item) => `${item.file}:${item.sha256}`).join("\n"),
  );
  return {
    source,
    parsed,
    normalized: normalizeSymbol(parsed, hash),
    hash,
    sourceFiles: inherited.sources.map((item) => ({
      fileName: path.basename(item.file),
      sourceItemName: item.sourceItemName,
      sha256: item.sha256,
    })),
  };
}

/** Load an already-imported footprint's pads from its on-disk sidecar so an
 * `existing` manifest reference can validate pinMaps without re-importing. */
function resolveExistingFootprint(
  outRoot: string,
  manifestFootprint: ManifestFootprint,
): ResolvedFootprint {
  const part = idPart(manifestFootprint.id, "openpcb.core.footprint.");
  const file = path.join(
    outRoot,
    "footprints",
    part.category,
    `${part.slug}.fp.json`,
  );
  if (!existsSync(file))
    throw new Error(
      `existing footprint ${manifestFootprint.id} not found at ${file}`,
    );
  const sidecar = JSON.parse(readFileSync(file, "utf8")) as {
    normalized?: { preview?: { pads?: Array<{ number?: string }> } };
  };
  const pads = sidecar.normalized?.preview?.pads;
  if (!pads)
    throw new Error(
      `existing footprint ${manifestFootprint.id} sidecar has no normalized.preview.pads`,
    );
  // Only `source` + `normalized.preview.pads` are consumed on the existing
  // path (pinMapFor / validateStrictPinMap); asset writes are skipped.
  return {
    source: file,
    normalized: { preview: { pads } },
  } as unknown as ResolvedFootprint;
}

async function resolveFootprint(
  kicadRoot: string,
  manifestFootprint: ManifestFootprint,
): Promise<ResolvedFootprint> {
  const source = sourcePath(kicadRoot, manifestFootprint.path!);
  if (!existsSync(source))
    throw new Error(`missing footprint source: ${source}`);
  const content = await readFile(source, "utf8");
  const hash = sha256(content);
  const parsed = parseKicadFootprint(content);
  const normalized = normalizeFootprint(parsed, hash, path.basename(source));
  // Unnumbered pads are NPTH/mechanical (mounting holes, fiducials, connector
  // pegs) — electrical integrity is still enforced by pinMapFor/strict pinMap.
  validateFootprintPads(normalized.preview, { allowUnnumberedPads: true });
  return { source, parsed, normalized, hash };
}

/** A pad carries an electrical net only if it has a non-empty number; empty/null
 * pads are NPTH/mechanical (mounting holes, edge slots) and need no pinMap. */
function isElectricalPadNumber(num: string | null | undefined): num is string {
  return typeof num === "string" && num.trim().length > 0;
}

function pinMapFor(
  symbol: ResolvedSymbol,
  footprint: ResolvedFootprint,
  configured: PinMapEntry[] | undefined,
): PinMapEntry[] {
  const symbolPins = new Set(
    symbol.normalized.pins
      .map((pin) => pin.number)
      .filter((number): number is string => number !== null),
  );
  const footprintPads = new Set(
    footprint.normalized.preview.pads.map((pad) => pad.number),
  );
  const pinMap =
    configured ??
    [...symbolPins].map((number) => ({ pinNumber: number, padNumber: number }));
  const mappedPins = new Set<string>();
  for (const entry of pinMap) {
    mappedPins.add(entry.pinNumber);
    if (!symbolPins.has(entry.pinNumber))
      throw new Error(
        `pinMap references unknown symbol pin ${entry.pinNumber} on ${symbol.source}`,
      );
    if (!footprintPads.has(entry.padNumber))
      throw new Error(
        `pinMap references unknown footprint pad ${entry.padNumber} on ${footprint.source}`,
      );
  }
  const missing = [...symbolPins].filter((pin) => !mappedPins.has(pin));
  if (missing.length > 0)
    throw new Error(
      `pinMap does not cover symbol pin(s) ${missing.join(", ")} on ${symbol.source}`,
    );
  return pinMap;
}

function validateStrictPinMap(
  symbol: ResolvedSymbol,
  footprint: ResolvedFootprint,
  configured: PinMapEntry[] | undefined,
  pinMap: PinMapEntry[],
): void {
  if (!configured)
    throw new Error(
      `strict mode requires explicit pinMap for ${footprint.source}`,
    );
  const mappedPads = new Set(pinMap.map((entry) => entry.padNumber));
  const unmappedPads = footprint.normalized.preview.pads
    .map((pad) => pad.number)
    // Empty-number pads are NPTH/mechanical (mounting holes, edge slots) — never
    // electrically mapped, so they don't need a pinMap entry.
    .filter((pad) => isElectricalPadNumber(pad) && !mappedPads.has(pad));
  if (unmappedPads.length > 0)
    throw new Error(
      `strict mode found unmapped footprint pad(s) ${unmappedPads.join(", ")} on ${footprint.source}`,
    );
  const pinNamesByNumber = new Map(
    symbol.normalized.pins.map((pin) => [pin.number, pin.name]),
  );
  for (const entry of pinMap) {
    const actualName = pinNamesByNumber.get(entry.pinNumber);
    if (entry.pinName && actualName && entry.pinName !== actualName)
      throw new Error(
        `strict mode pinName mismatch for pin ${entry.pinNumber}: manifest has ${entry.pinName}, symbol has ${actualName}`,
      );
  }
}

async function writeJson(
  file: string,
  data: unknown,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function copyAsset(
  source: string,
  target: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

function rememberPath(
  paths: Map<string, string>,
  file: string,
  source: string,
  allowOverwrite: boolean,
): void {
  const hit = paths.get(file);
  if (hit && hit !== source) throw new Error(`output path collision: ${file}`);
  if (!hit && !allowOverwrite && existsSync(file))
    throw new Error(
      `output path already exists: ${file} (pass --allow-overwrite to replace)`,
    );
  paths.set(file, source);
}

function validateStrictModelRef(
  footprint: ResolvedFootprint,
  stepSource: string,
): void {
  const stepName = path.basename(stepSource);
  const match = footprint.parsed.model3dRefs.find(
    (ref) => ref.resolvedFileName === stepName,
  );
  if (!match)
    throw new Error(
      `strict mode requires footprint ${footprint.source} to reference STEP ${stepName}`,
    );
}

async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const manifest = await loadManifest(args.manifest);
  validateManifestShape(manifest);
  const outputPaths = new Map<string, string>();
  let componentCount = 0;
  const symbolIds = new Set<string>();
  const footprintIds = new Set<string>();
  const modelIds = new Set<string>();

  for (const component of manifest.components) {
    const symbol = await resolveSymbol(args.kicadRoot, component.symbol);
    const symbolPart = idPart(component.symbol.id, "openpcb.core.symbol.");
    const symbolPath = path.join(
      args.out,
      "symbols",
      symbolPart.category,
      `${symbolPart.slug}.symbol.json`,
    );
    rememberPath(
      outputPaths,
      symbolPath,
      component.symbol.path,
      args.allowOverwrite,
    );
    if (!symbolIds.has(component.symbol.id)) {
      await writeJson(
        symbolPath,
        {
          id: component.symbol.id,
          uuid: uuidFromSeed(component.symbol.id),
          version: manifest.version,
          name: component.name,
          referencePrefix: symbol.normalized.referencePrefix,
          description:
            symbol.normalized.description ??
            `${component.name} symbol imported from KiCad`,
          provenance: provenance(
            "kicad-sym",
            symbol.source,
            symbol.parsed.name,
            symbol.hash,
            args.convertedAt,
          ),
          parser: {
            warnings: symbol.parsed.warnings,
            properties: symbol.parsed.properties,
            units: symbol.parsed.units,
            sourceFiles: symbol.sourceFiles,
          },
          normalized: symbol.normalized,
          raw: symbol.parsed,
        },
        args.dryRun,
      );
      symbolIds.add(component.symbol.id);
    }

    const componentFootprints: Array<{
      footprint: string;
      label: string;
      pinMap: PinMapEntry[];
    }> = [];
    for (const manifestFootprint of component.footprints) {
      const footprint = manifestFootprint.existing
        ? resolveExistingFootprint(args.out, manifestFootprint)
        : await resolveFootprint(args.kicadRoot, manifestFootprint);
      const pinMap = pinMapFor(symbol, footprint, manifestFootprint.pinMap);
      if (args.strict)
        validateStrictPinMap(
          symbol,
          footprint,
          manifestFootprint.pinMap,
          pinMap,
        );
      componentFootprints.push({
        footprint: manifestFootprint.id,
        label: manifestFootprint.label,
        pinMap,
      });
      if (manifestFootprint.existing) continue;

      const footprintPart = idPart(
        manifestFootprint.id,
        "openpcb.core.footprint.",
      );
      const footprintPath = path.join(
        args.out,
        "footprints",
        footprintPart.category,
        `${footprintPart.slug}.fp.json`,
      );
      rememberPath(
        outputPaths,
        footprintPath,
        manifestFootprint.path!,
        args.allowOverwrite,
      );
      if (!footprintIds.has(manifestFootprint.id)) {
        await writeJson(
          footprintPath,
          {
            id: manifestFootprint.id,
            uuid: uuidFromSeed(manifestFootprint.id),
            version: manifest.version,
            name: footprint.parsed.name,
            mountType: footprint.normalized.mountType,
            package: footprint.normalized.packageCode,
            models3d: manifestFootprint.no3d
              ? []
              : [manifestFootprint.model!.id],
            ...(manifestFootprint.no3d ? { no3d: true } : {}),
            ...(manifestFootprint.orientationHint
              ? { orientationHint: manifestFootprint.orientationHint }
              : {}),
            ...(manifestFootprint.belowBoardBudgetMm
              ? { belowBoardBudgetMm: manifestFootprint.belowBoardBudgetMm }
              : {}),
            provenance: provenance(
              "kicad-mod",
              footprint.source,
              footprint.parsed.name,
              footprint.hash,
              args.convertedAt,
            ),
            parser: { warnings: footprint.parsed.warnings },
            normalized: footprint.normalized,
            raw: footprint.parsed,
            sourceFileName: path.basename(footprint.source),
          },
          args.dryRun,
        );
        footprintIds.add(manifestFootprint.id);
      }

      if (!manifestFootprint.no3d) {
        const model = manifestFootprint.model!;
        const stepSource = sourcePath(args.kicadRoot, model.path);
        if (!existsSync(stepSource))
          throw new Error(`missing STEP source: ${stepSource}`);
        if (args.strict) validateStrictModelRef(footprint, stepSource);
        const modelPart = idPart(model.id, "openpcb.core.3d.");
        const modelRel = path
          .join("3d", modelPart.category, `${modelPart.slug}.step`)
          .split(path.sep)
          .join("/");
        const modelPath = path.join(
          args.out,
          "3d",
          modelPart.category,
          `${modelPart.slug}.model.json`,
        );
        const stepPath = path.join(args.out, modelRel);
        rememberPath(outputPaths, modelPath, model.path, args.allowOverwrite);
        rememberPath(outputPaths, stepPath, model.path, args.allowOverwrite);
        if (!modelIds.has(model.id)) {
          const modelRef =
            footprint.parsed.model3dRefs.find(
              (ref) => ref.resolvedFileName === path.basename(stepSource),
            ) ?? footprint.parsed.model3dRefs[0];
          const stepHash = sha256File(stepSource);
          await writeJson(
            modelPath,
            {
              id: model.id,
              uuid: uuidFromSeed(model.id),
              version: manifest.version,
              name: `${footprint.parsed.name} STEP model`,
              formats: { step: { path: modelRel, sha256: stepHash } },
              provenance: provenance(
                "step",
                stepSource,
                path.basename(stepSource),
                stepHash,
                args.convertedAt,
              ),
              offsetMm: model.offsetMm ??
                modelRef?.offset ?? { x: 0, y: 0, z: 0 },
              rotationDeg: model.rotationDeg ??
                modelRef?.rotation ?? { x: 0, y: 0, z: 0 },
              scaleMm: model.scaleMm ?? modelRef?.scale ?? { x: 1, y: 1, z: 1 },
            },
            args.dryRun,
          );
          await copyAsset(stepSource, stepPath, args.dryRun);
          modelIds.add(model.id);
        }
      }
    }

    if (
      !componentFootprints.some(
        (item) => item.footprint === component.defaultFootprint,
      )
    )
      throw new Error(
        `${component.id} defaultFootprint is not in footprints[]`,
      );
    const componentPart = idPart(component.id, "openpcb.core.");
    const componentPath = path.join(
      args.out,
      "components",
      component.category,
      `${componentPart.slug}.component.json`,
    );
    rememberPath(outputPaths, componentPath, component.id, args.allowOverwrite);
    const kicadDatasheet = symbol.parsed.properties.Datasheet?.trim();
    const datasheetSource =
      component.datasheetSource ??
      (kicadDatasheet && /^https?:\/\//i.test(kicadDatasheet)
        ? kicadDatasheet
        : undefined);
    await writeJson(
      componentPath,
      {
        id: component.id,
        uuid: uuidFromSeed(component.id),
        version: manifest.version,
        name: component.name,
        description: component.description,
        category: component.category,
        ...(component.subcategory !== undefined
          ? { subcategory: component.subcategory }
          : {}),
        tags: uniqueTags(component.tags),
        ...(component.keywords !== undefined
          ? { keywords: component.keywords }
          : {}),
        aliases: component.aliases ?? [],
        ...(component.datasheet !== undefined
          ? { datasheet: component.datasheet }
          : {}),
        ...(datasheetSource !== undefined ? { datasheetSource } : {}),
        ...(component.parameters !== undefined
          ? { parameters: component.parameters }
          : {}),
        ...(component.manufacturerParts !== undefined
          ? { manufacturerParts: component.manufacturerParts }
          : {}),
        symbol: component.symbol.id,
        defaultFootprint: component.defaultFootprint,
        footprints: componentFootprints,
        provenance: provenance(
          "openpcb-component",
          symbol.source,
          component.name,
          sha256(
            `${component.id}:${component.footprints.map((item) => item.id).join(":")}`,
          ),
          args.convertedAt,
        ),
        compatibility: component.compatibility ?? {
          minOpenPcbVersion: "0.1.0",
        },
      },
      args.dryRun,
    );
    componentCount += 1;
  }

  const action = args.dryRun ? "validated" : "wrote";
  const mode = args.strict ? " strict" : "";
  console.log(
    `[import-kicad-batch]${mode} ${action} ${componentCount} components, ${symbolIds.size} symbols, ${footprintIds.size} footprints, ${modelIds.size} STEP models`,
  );
}

run(Bun.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[import-kicad-batch] ${message}`);
  process.exit(1);
});
