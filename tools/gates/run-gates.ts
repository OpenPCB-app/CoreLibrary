/**
 * Thin adapter between tools/validate.ts and the numbered gate modules
 * (G6–G12). validate.ts loads the JSON and reports; the gate modules stay
 * pure. Severity mapping (fail always fatal, warn fatal under --strict,
 * note advisory) is validate.ts's job — this file only collects findings.
 */
import { checkDatasheetCoherence } from "./datasheet-coherence";
import { checkFootprintDrc, type DrcFootprint } from "./footprint-drc";
import { isGenericComponent } from "./generic-ids";
import { checkMountType, type MountTypeInput } from "./mount-type";
import { checkRequiredParameters } from "./parameters-required";
import { checkSourcing, type ManufacturerPartEntry } from "./sourcing";
import {
  checkNoConnectPads,
  checkSymbolErc,
  type SymbolErcInput,
} from "./symbol-erc";
import type { GateFinding } from "./types";

export interface GateComponent {
  id: string;
  category?: string;
  description?: string;
  keywords?: string[];
  parameters?: Record<string, unknown>;
  manufacturerParts?: ManufacturerPartEntry[];
  datasheet?: string | null;
  symbol: string;
  footprints: Array<{
    footprint: string;
    pinMap?: Array<{ pinNumber: string; padNumber: string }>;
  }>;
}

export type GateSymbol = SymbolErcInput;
export type GateFootprint = DrcFootprint & MountTypeInput;

export function runFootprintGates(footprint: GateFootprint): GateFinding[] {
  return [...checkFootprintDrc(footprint), ...checkMountType(footprint)];
}

/**
 * Component-scoped gates. G9 runs on the component's symbol here (not in the
 * symbol loop) because "generic" is a property of the owning component; a
 * symbol shared by several components is checked once, via `seenSymbols`.
 */
export function runComponentGates(
  component: GateComponent,
  symbol: GateSymbol | undefined,
  seenSymbols: Set<string>,
): GateFinding[] {
  const category = component.category ?? "";
  const generic = isGenericComponent(component.id, category);
  const out: GateFinding[] = [
    ...checkRequiredParameters(component),
    ...checkSourcing(component),
    ...checkDatasheetCoherence(component),
  ];
  if (!symbol) return out;
  const pins = (symbol.normalized?.pins ?? []).map((pin) => ({
    number: pin.number ?? "",
    electricalType: pin.electricalType ?? "",
  }));
  out.push(...checkNoConnectPads(component, pins));
  if (!seenSymbols.has(symbol.id)) {
    seenSymbols.add(symbol.id);
    out.push(...checkSymbolErc(symbol, { category, generic }));
  }
  return out;
}
