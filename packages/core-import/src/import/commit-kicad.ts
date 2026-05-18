/**
 * Pure import-commit step.
 *
 * Takes a parsed KiCad import bundle + user selections, returns three plain
 * JSON-schema-compliant objects (symbol/footprint/component) ready to be
 * written to disk by the caller. No DB, no FS — caller persists.
 *
 * Adapted from OpenPCB's `src/modules/library/backend/import/commit-kicad.ts`
 * with the Drizzle `db.transaction(...)` block stripped and the output shape
 * mapped to CoreLibrary's JSON schemas (id/uuid/version/provenance required).
 */

import { ImportValidationError } from "../errors";
import { parseImportBundle } from "./inspect-kicad";
import type { CommitKicadRequest } from "./contracts";
import {
  validateFootprintPads,
  validateSymbolPinsCoverFootprintPads,
} from "./validate-pads";
import { buildIdentityPinMap } from "./pinmap";

const SCHEMA_VERSION = "1.0.0";

export interface CommitInput extends CommitKicadRequest {
  component: CommitKicadRequest["component"] & {
    /** Free-form kebab-case repo category. Drives id + on-disk subfolder. */
    category: string;
    /** SPDX license id (e.g. "CC-BY-4.0", "MIT", "CC0-1.0", "proprietary"). */
    license: string;
    /** Optional list of attribution strings (author/source URLs). */
    attribution?: string[];
    /** Optional kebab-case slug override; defaults to slugify(name). */
    slug?: string;
  };
}

export interface CommittedSymbol {
  id: string;
  uuid: string;
  version: string;
  name: string;
  referencePrefix: string;
  description?: string;
  provenance: ProvenanceImported;
  parser: { warnings: unknown[]; properties: unknown; units: unknown };
  normalized: unknown;
  raw: unknown;
}

export interface CommittedFootprint {
  id: string;
  uuid: string;
  version: string;
  name: string;
  mountType: "smd" | "tht" | "through_hole" | "press_fit" | "mixed";
  models3d: string[];
  provenance: ProvenanceImported;
  parser: { warnings: unknown[] };
  normalized: unknown;
  raw: unknown;
}

export interface CommittedComponent {
  id: string;
  uuid: string;
  version: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  symbol: string;
  defaultFootprint: string;
  footprints: Array<{
    footprint: string;
    label: string;
    pinMap?: Array<{
      pinNumber: string;
      padNumber: string;
      pinName?: string | null;
    }>;
  }>;
  provenance: { source: string; license: string; attribution?: string[] };
}

export interface CommitOutput {
  symbol: CommittedSymbol;
  footprint: CommittedFootprint | null;
  component: CommittedComponent;
}

interface ProvenanceImported {
  sourceKind: "imported";
  sourceFormat: "kicad_sym" | "kicad_mod";
  fileName: string;
  importedAt: string;
  sourceHash: string;
  license: string;
  attribution?: string[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildId(
  kind: "symbol" | "footprint" | "component",
  category: string,
  slug: string,
): string {
  const cat = slugify(category) || "imported";
  const s = slug || "untitled";
  if (kind === "component") return `openpcb.core.${cat}.${s}`;
  return `openpcb.core.${cat}.${kind}.${s}`;
}

function normalizeMountType(mt: string): CommittedFootprint["mountType"] {
  const v = mt?.toLowerCase().trim() ?? "";
  if (v === "smd") return "smd";
  if (v === "tht" || v === "through_hole" || v === "throughhole") return "tht";
  if (v === "press_fit" || v === "press-fit") return "press_fit";
  if (v === "mixed") return "mixed";
  return "tht";
}

function dedupeTags(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of values) {
    const n = t.trim().toLowerCase();
    if (n.length === 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function require_(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new ImportValidationError(`${field} must not be empty`);
  }
  return trimmed;
}

export function commitKicadImport(input: CommitInput): CommitOutput {
  const parsed = parseImportBundle(input);

  const componentName = require_(input.component.name, "component.name");
  const category = require_(input.component.category, "component.category");
  const license = require_(input.component.license, "component.license");
  const description = (input.component.description ?? "").trim();
  const userTags = dedupeTags(input.component.tags ?? []);
  const slug = slugify(input.component.slug ?? componentName);
  if (!slug) {
    throw new ImportValidationError(
      "Cannot derive a slug from component.name — provide component.slug",
    );
  }

  const selectedSymbolId = require_(
    input.selection.symbolId,
    "selection.symbolId",
  );
  const selectedFootprintRequestId = (input.selection.footprintId ?? "").trim();
  const symbolOnly = selectedFootprintRequestId.length === 0;

  const selectedSymbol = parsed.normalizedSymbols.find(
    (s) => s.id === selectedSymbolId,
  );
  if (!selectedSymbol) {
    throw new ImportValidationError(
      "Selected symbol is not present in import payload",
    );
  }

  if (symbolOnly) {
    throw new ImportValidationError(
      "A footprint must be selected — CoreLibrary component schema requires at least one footprint variant.",
    );
  }
  const selectedFootprint =
    parsed.normalizedFootprints.find(
      (f) => f.id === selectedFootprintRequestId,
    ) ?? null;
  if (!selectedFootprint) {
    throw new ImportValidationError(
      "Selected footprint is not present in import payload",
    );
  }

  if (selectedFootprint) {
    validateFootprintPads(selectedFootprint.preview);
    validateSymbolPinsCoverFootprintPads(
      selectedSymbol,
      selectedFootprint.preview,
    );
  }

  const rawSymbol = parsed.raw.symbolById[selectedSymbolId];
  if (!rawSymbol) {
    throw new ImportValidationError("Raw symbol payload missing");
  }
  const rawFootprint = selectedFootprint
    ? parsed.raw.footprintById[selectedFootprint.id]
    : null;

  const importedAt = new Date().toISOString();
  const symbolId = buildId("symbol", category, slug);
  const footprintId = selectedFootprint
    ? buildId("footprint", category, slug)
    : null;
  const componentId = buildId("component", category, slug);

  const attribution = input.component.attribution?.filter(
    (a) => a.trim().length > 0,
  );

  const provenanceCommon: Omit<
    ProvenanceImported,
    "sourceFormat" | "fileName" | "sourceHash"
  > = {
    sourceKind: "imported",
    importedAt,
    license,
    ...(attribution && attribution.length > 0 ? { attribution } : {}),
  };

  const symbolFile: CommittedSymbol = {
    id: symbolId,
    uuid: crypto.randomUUID(),
    version: SCHEMA_VERSION,
    name: selectedSymbol.name,
    referencePrefix: selectedSymbol.referencePrefix,
    ...(selectedSymbol.description
      ? { description: selectedSymbol.description }
      : {}),
    provenance: {
      ...provenanceCommon,
      sourceFormat: "kicad_sym",
      fileName: parsed.raw.symbolFileName,
      sourceHash: selectedSymbol.sourceHash,
    },
    parser: {
      warnings: rawSymbol.warnings,
      properties: rawSymbol.properties,
      units: rawSymbol.units,
    },
    normalized: selectedSymbol,
    raw: rawSymbol,
  };

  let footprintFile: CommittedFootprint | null = null;
  if (selectedFootprint && rawFootprint && footprintId) {
    footprintFile = {
      id: footprintId,
      uuid: crypto.randomUUID(),
      version: SCHEMA_VERSION,
      name: selectedFootprint.name,
      mountType: normalizeMountType(selectedFootprint.mountType),
      models3d: [],
      provenance: {
        ...provenanceCommon,
        sourceFormat: "kicad_mod",
        fileName:
          parsed.raw.footprintFileByName[selectedFootprint.name] ??
          selectedFootprint.fileName,
        sourceHash: selectedFootprint.sourceHash,
      },
      parser: { warnings: rawFootprint.warnings ?? [] },
      normalized: selectedFootprint,
      raw: rawFootprint,
    };
  }

  const componentTags = dedupeTags([
    ...userTags,
    ...(selectedFootprint?.tags ?? []),
    selectedSymbol.warnings.length + (selectedFootprint?.warnings.length ?? 0) >
    0
      ? "has-warnings"
      : "",
  ]);

  const pinMap = selectedFootprint
    ? buildIdentityPinMap(selectedSymbol, selectedFootprint.preview)
    : [];

  const componentFile: CommittedComponent = {
    id: componentId,
    uuid: crypto.randomUUID(),
    version: SCHEMA_VERSION,
    name: componentName,
    description:
      description.length > 0
        ? description
        : (selectedSymbol.description ?? selectedFootprint?.description ?? ""),
    category,
    tags: componentTags,
    symbol: symbolId,
    defaultFootprint: footprintId ?? symbolId, // schema requires; if no fp, point at symbol (caller can adjust)
    footprints: footprintId
      ? [
          {
            footprint: footprintId,
            label: selectedFootprint!.name,
            ...(pinMap.length > 0 ? { pinMap } : {}),
          },
        ]
      : [],
    provenance: {
      source: "kicad-derived",
      license,
      ...(attribution && attribution.length > 0 ? { attribution } : {}),
    },
  };

  return {
    symbol: symbolFile,
    footprint: footprintFile,
    component: componentFile,
  };
}
