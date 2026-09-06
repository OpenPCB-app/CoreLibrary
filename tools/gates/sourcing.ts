/**
 * G7 — sourcing completeness. A function-standard, non-generic component
 * should resolve to at least one real, purchasable manufacturer part, and
 * every component (generic or not) needs the search metadata
 * (description/keywords) the library UI filters on.
 *
 * Structural entry shape is `fail` (a malformed sourcing record is unusable
 * data, not a content gap); missing sourcing entirely, or a missing per-part
 * datasheet, is advisory `warn`.
 *
 * Pure module — the caller (tools/validate.ts, wired later) supplies the
 * loaded component and renders the findings.
 */
import { finding, type GateFinding } from "./types";
import { isGenericComponent } from "./generic-ids";

export interface ManufacturerPartEntry {
  manufacturer: string;
  mpn: string;
  lcsc?: string;
  jlcpcbAssemblyType?: "basic" | "preferred" | "extended";
  package?: string;
  role?: "primary" | "alternate";
  datasheet?: string;
}

export interface SourcingInput {
  id: string;
  category?: string;
  description?: string;
  keywords?: string[];
  manufacturerParts?: ManufacturerPartEntry[];
  datasheet?: string | null;
}

const LCSC_RE = /^C\d+$/;
const ASSEMBLY_TYPES = new Set(["basic", "preferred", "extended"]);
const ROLES = new Set(["primary", "alternate"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function checkEntry(
  id: string,
  index: number,
  entry: ManufacturerPartEntry,
): GateFinding[] {
  const out: GateFinding[] = [];
  const tag = `${id} manufacturerParts[${index}]`;

  if (!isNonEmptyString(entry.manufacturer))
    out.push(finding("G7", "fail", `${tag} is missing manufacturer`));
  if (!isNonEmptyString(entry.mpn))
    out.push(finding("G7", "fail", `${tag} is missing mpn`));
  if (entry.lcsc !== undefined && !LCSC_RE.test(entry.lcsc))
    out.push(
      finding("G7", "fail", `${tag}.lcsc '${entry.lcsc}' must match C<digits>`),
    );
  if (
    entry.jlcpcbAssemblyType !== undefined &&
    !ASSEMBLY_TYPES.has(entry.jlcpcbAssemblyType)
  )
    out.push(
      finding(
        "G7",
        "fail",
        `${tag}.jlcpcbAssemblyType '${entry.jlcpcbAssemblyType}' must be basic, preferred, or extended`,
      ),
    );
  if (entry.role !== undefined && !ROLES.has(entry.role))
    out.push(
      finding("G7", "fail", `${tag}.role '${entry.role}' must be primary or alternate`),
    );
  if (index === 0 && entry.role === "alternate")
    out.push(finding("G7", "fail", `${tag} (first entry) must not be role 'alternate'`));
  if (index > 0 && entry.role === "primary")
    out.push(
      finding("G7", "fail", `${tag} must not be role 'primary' — only the first entry may be`),
    );
  return out;
}

export function checkSourcing(component: SourcingInput): GateFinding[] {
  const { id, category, description, keywords, manufacturerParts } = component;
  const out: GateFinding[] = [];

  if (!isNonEmptyString(description))
    out.push(finding("G7", "warn", `${id} has no description`));
  if (!keywords || keywords.length === 0)
    out.push(finding("G7", "warn", `${id} has no keywords`));

  if (isGenericComponent(id, category)) return out;

  const entries = manufacturerParts ?? [];
  if (entries.length === 0) {
    out.push(finding("G7", "warn", `${id} (${category}) has no manufacturerParts`));
    return out;
  }

  entries.forEach((entry, index) => out.push(...checkEntry(id, index, entry)));
  // A datasheet may live on the component or on the primary entry.
  if (!component.datasheet && !entries.some((entry) => Boolean(entry.datasheet)))
    out.push(finding("G7", "warn", `${id} has no datasheet`));
  return out;
}
