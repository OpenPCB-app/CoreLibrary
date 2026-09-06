/**
 * G6 — headline parameter completeness for function-standard components.
 * `parameters` carries the datasheet-native specs a part needs to be usable
 * in search/filtering (see docs/PARAMETERS.md); a real MOSFET missing
 * `rds_on` or a zener missing `vz` is a content gap, not a schema violation —
 * so this is advisory (`warn`), never `fail`. Generic templates (G_NMOS_GSD,
 * a bare LED) carry no headline specs of their own and are skipped entirely.
 *
 * Pure module — the caller (tools/validate.ts, wired later) supplies the
 * loaded component and renders the findings.
 */
import { finding, type GateFinding } from "./types";
import { isGenericComponent } from "./generic-ids";
import {
  PARAMETER_TYPE_VALUES,
  REQUIRED_PARAMETER_KEYS,
} from "../parameter-dictionary";

export interface RequiredParametersInput {
  id: string;
  category?: string;
  parameters?: Record<string, unknown>;
}

function isMissing(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** "NOR flash" -> "nor-flash", "npn" -> "npn" — matches the dictionary's lowercase-hyphen values. */
function normalizeType(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function checkAlways(
  id: string,
  category: string,
  params: Record<string, unknown>,
  keys: string[],
): GateFinding[] {
  return keys
    .filter((key) => isMissing(params[key]))
    .map((key) =>
      finding(
        "G6",
        "warn",
        `${id} is missing required parameter '${key}' for category '${category}'`,
      ),
    );
}

function checkTypeValue(
  id: string,
  category: string,
  rawType: string,
  byType: Record<string, string[]> | undefined,
  params: Record<string, unknown>,
): GateFinding[] {
  const out: GateFinding[] = [];
  const normalized = normalizeType(rawType);
  const allowed = PARAMETER_TYPE_VALUES[category];
  if (allowed && !allowed.includes(normalized)) {
    out.push(
      finding(
        "G6",
        "warn",
        `${id} parameters.type '${rawType}' is not a recognized ${category} type (expected one of: ${allowed.join(", ")})`,
      ),
    );
  }
  for (const key of byType?.[normalized] ?? []) {
    if (isMissing(params[key]))
      out.push(
        finding(
          "G6",
          "warn",
          `${id} is missing required parameter '${key}' for ${category} type '${rawType}'`,
        ),
      );
  }
  return out;
}

export function checkRequiredParameters(
  component: RequiredParametersInput,
): GateFinding[] {
  const { id, category, parameters } = component;
  if (!category || isGenericComponent(id, category)) return [];
  const spec = REQUIRED_PARAMETER_KEYS[category];
  if (!spec) return [];

  const params = parameters ?? {};
  if (Object.keys(params).length === 0)
    return [
      finding(
        "G6",
        "warn",
        `${id} (${category}) has no parameters — requires ${spec.always.join(", ")}`,
      ),
    ];

  const out = checkAlways(id, category, params, spec.always);
  const rawType = params.type;
  if (typeof rawType === "string" && rawType.trim() !== "")
    out.push(...checkTypeValue(id, category, rawType, spec.byType, params));

  return out;
}
