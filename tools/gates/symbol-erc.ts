/**
 * G9 — symbol electrical-type sanity ("lite ERC"): pin documentation gaps
 * (blank names, missing supply pin) and coordinate-stacking shorts, visible
 * from a symbol alone (mirrors the G1c/G1d stacked-pin notion in
 * tools/validate.ts, scoped to electrical meaning instead of preview parity).
 *
 * Pure functions only — the caller (tools/validate.ts, wired later) supplies
 * symbol/category/generic data and decides how severities gate exit codes.
 */
import { finding, type GateFinding } from "./types";

export interface SymbolErcPin {
  number?: string;
  name?: string;
  electricalType?: string;
  unit?: number;
  localPosition?: { x: number; y: number };
}

export interface SymbolErcInput {
  id: string;
  normalized?: {
    pins?: SymbolErcPin[];
  };
}

export interface SymbolErcOptions { category: string; generic: boolean }

// Values the KiCad importer produces, plus a few upstream KiCad ERC types not
// yet seen in this tree. Anything else is a typo or a hand-authored value.
const KNOWN_ELECTRICAL_TYPES = new Set([
  "bidirectional",
  "passive",
  "input",
  "power_in",
  "output",
  "power_out",
  "tri_state",
  "open_collector",
  "open_emitter",
  "no_connect",
  "unspecified",
  "free",
]);

// Missing power_in is only a real smell for categories with an internal
// bias/supply path; opto/transistor/diode/etc. symbols are signal-only.
const POWER_IN_CHECK_CATEGORIES = new Set(["ic", "power", "sensor"]);

// Symbols in a power_in-checked category with no dedicated supply pin by
// construction — two/three-terminal shunt regulators whose "cathode" pin
// carries operating current instead of a separate Vcc.
export const POWER_IN_EXEMPT_SYMBOL_IDS = new Set([
  // Shunt regulator: K/REF/A only, biased via an external resistor off the
  // rail it regulates — no supply pin to mark.
  "openpcb.core.symbol.power.tl431",
  // Shunt voltage reference: 2-terminal (K/A) + NC, same topology as tl431.
  "openpcb.core.symbol.power.lm4040-2v5",
]);

// Categories with a functional (non-generic) part identity, where a blank pin
// name is a documentation gap, not an intentionally undifferentiated pinout.
const FUNCTION_CATEGORIES = new Set([
  "ic",
  "power",
  "transistor",
  "diode",
  "sensor",
  "opto",
  "crystal",
  "relay",
  "switch",
  "audio",
  "battery",
]);

// Types that legitimately repeat the same name across many pins (every GND,
// every NC) — not a duplicate-signal smell.
const DUPLICATE_NAME_EXEMPT_TYPES = new Set([
  "passive",
  "power_in",
  "power_out",
  "no_connect",
]);

function pins(symbol: SymbolErcInput): SymbolErcPin[] {
  return symbol.normalized?.pins ?? [];
}

function coordKey(pin: SymbolErcPin): string | undefined {
  const pos = pin.localPosition;
  return pos ? `${pos.x},${pos.y}` : undefined;
}

function groupByUnit(list: SymbolErcPin[]): Map<number, SymbolErcPin[]> {
  const byUnit = new Map<number, SymbolErcPin[]>();
  for (const pin of list) {
    const unit = pin.unit ?? 1;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), pin]);
  }
  return byUnit;
}

function checkUnknownElectricalTypes(symbol: SymbolErcInput): GateFinding[] {
  const out: GateFinding[] = [];
  for (const pin of pins(symbol)) {
    const type = pin.electricalType;
    if (type !== undefined && !KNOWN_ELECTRICAL_TYPES.has(type)) {
      out.push(
        finding(
          "G9",
          "warn",
          `${symbol.id} pin ${pin.number ?? "?"} has unknown electricalType "${type}"`,
        ),
      );
    }
  }
  return out;
}

function checkMissingPowerIn(
  symbol: SymbolErcInput,
  opts: SymbolErcOptions,
): GateFinding[] {
  if (opts.generic || !POWER_IN_CHECK_CATEGORIES.has(opts.category)) return [];
  if (POWER_IN_EXEMPT_SYMBOL_IDS.has(symbol.id)) return [];
  const hasPowerIn = pins(symbol).some((pin) => pin.electricalType === "power_in");
  if (hasPowerIn) return [];
  return [
    finding(
      "G9",
      "warn",
      `${symbol.id} (${opts.category}) has no power_in pin — mark the supply pin power_in`,
    ),
  ];
}

function checkBlankPinNames(
  symbol: SymbolErcInput,
  opts: SymbolErcOptions,
): GateFinding[] {
  if (opts.generic || !FUNCTION_CATEGORIES.has(opts.category)) return [];
  const blanks = pins(symbol)
    .filter((pin) => !(pin.name ?? "").trim())
    .map((pin) => pin.number ?? "?");
  if (blanks.length === 0) return [];
  // KiCad draws gate/op-amp units with unnamed I/O pins by convention; on a
  // multi-unit symbol that is documentation style, not a wiring hazard.
  const multiUnit = new Set(pins(symbol).map((pin) => pin.unit ?? 1)).size > 1;
  return [
    finding(
      "G9",
      multiUnit ? "note" : "warn",
      `${symbol.id} has ${blanks.length} pin(s) with a blank name: ${blanks.join(", ")}`,
    ),
  ];
}

function checkDuplicateSignalNames(symbol: SymbolErcInput): GateFinding[] {
  const out: GateFinding[] = [];
  for (const [unit, unitPins] of groupByUnit(pins(symbol))) {
    const byName = new Map<string, SymbolErcPin[]>();
    for (const pin of unitPins) {
      const name = (pin.name ?? "").trim();
      if (name) byName.set(name, [...(byName.get(name) ?? []), pin]);
    }
    for (const [name, group] of byName) {
      const relevant = group.filter(
        (pin) =>
          pin.electricalType === undefined ||
          !DUPLICATE_NAME_EXEMPT_TYPES.has(pin.electricalType),
      );
      if (relevant.length < 2) continue;
      const coords = new Set(
        relevant.map((pin, index) => coordKey(pin) ?? `unresolved:${index}`),
      );
      if (coords.size <= 1) continue; // fully stacked — legitimate KiCad idiom
      out.push(
        finding(
          "G9",
          "note",
          `${symbol.id} unit ${unit} has duplicate signal name "${name}" on non-stacked pins ${relevant
            .map((pin) => pin.number ?? "?")
            .join(", ")}`,
        ),
      );
    }
  }
  return out;
}

function stackedGroups(unitPins: SymbolErcPin[]): SymbolErcPin[][] {
  const byCoord = new Map<string, SymbolErcPin[]>();
  for (const pin of unitPins) {
    const key = coordKey(pin);
    if (key) byCoord.set(key, [...(byCoord.get(key) ?? []), pin]);
  }
  return [...byCoord.values()].filter((group) => group.length > 1);
}

function checkStackedShorts(symbol: SymbolErcInput): GateFinding[] {
  const out: GateFinding[] = [];
  for (const [unit, unitPins] of groupByUnit(pins(symbol))) {
    for (const group of stackedGroups(unitPins)) {
      const outputs = group.filter((pin) => pin.electricalType === "output");
      if (outputs.length >= 2) {
        out.push(
          finding(
            "G9",
            "fail",
            `${symbol.id} unit ${unit} stacks ${outputs.length} output pins at one coordinate: ${outputs
              .map((pin) => pin.number ?? "?")
              .join(", ")} — output short by construction`,
          ),
        );
      }
      const hasPowerIn = group.some((pin) => pin.electricalType === "power_in");
      if (hasPowerIn && outputs.length > 0) {
        out.push(
          finding(
            "G9",
            "fail",
            `${symbol.id} unit ${unit} stacks a power_in pin against an output pin: ${group
              .map((pin) => `${pin.number ?? "?"}=${pin.electricalType}`)
              .join(", ")}`,
          ),
        );
      }
    }
  }
  return out;
}

export function checkSymbolErc(
  symbol: SymbolErcInput,
  opts: SymbolErcOptions,
): GateFinding[] {
  return [
    ...checkUnknownElectricalTypes(symbol),
    ...checkMissingPowerIn(symbol, opts),
    ...checkBlankPinNames(symbol, opts),
    ...checkDuplicateSignalNames(symbol),
    ...checkStackedShorts(symbol),
  ];
}

export interface NoConnectPinMapEntry { pinNumber: string; padNumber: string }

export interface NoConnectFootprintVariant {
  footprint: string;
  pinMap?: NoConnectPinMapEntry[];
}

export interface NoConnectComponentInput { id: string; footprints: NoConnectFootprintVariant[] }

export interface NoConnectSymbolPin { number: string; electricalType: string }

// A no_connect pin legitimately gets its own pad in KiCad footprints (the pad
// exists on the physical part; only the schematic pin is unused). The real
// fault is a pad ALSO driven by a different, connected pin — that ties the
// "do not connect" pin straight into a live signal.
export function checkNoConnectPads(
  component: NoConnectComponentInput,
  symbolPins: NoConnectSymbolPin[],
): GateFinding[] {
  const typeByNumber = new Map(symbolPins.map((pin) => [pin.number, pin.electricalType]));
  const out: GateFinding[] = [];

  for (const variant of component.footprints) {
    const padToPins = new Map<string, string[]>();
    for (const entry of variant.pinMap ?? []) {
      padToPins.set(entry.padNumber, [
        ...(padToPins.get(entry.padNumber) ?? []),
        entry.pinNumber,
      ]);
    }
    for (const [pad, pinNumbers] of padToPins) {
      const ncPins = pinNumbers.filter((n) => typeByNumber.get(n) === "no_connect");
      if (ncPins.length === 0) continue;
      const otherPins = pinNumbers.filter((n) => typeByNumber.get(n) !== "no_connect");
      if (otherPins.length > 0) {
        out.push(
          finding(
            "G9",
            "fail",
            `${component.id} footprint ${variant.footprint} pad ${pad} maps no_connect pin(s) ${ncPins.join(", ")} together with pin(s) ${otherPins.join(", ")} — no_connect pad is shared`,
          ),
        );
      } else {
        out.push(
          finding(
            "G9",
            "note",
            `${component.id} footprint ${variant.footprint} maps no_connect pin(s) ${ncPins.join(", ")} to pad ${pad}`,
          ),
        );
      }
    }
  }
  return out;
}
