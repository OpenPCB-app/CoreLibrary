import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  checkNoConnectPads,
  checkSymbolErc,
  POWER_IN_EXEMPT_SYMBOL_IDS,
  type NoConnectComponentInput,
  type NoConnectSymbolPin,
  type SymbolErcInput,
  type SymbolErcOptions,
  type SymbolErcPin,
} from "../tools/gates/symbol-erc";
import type { GateFinding, GateSeverity } from "../tools/gates/types";

const repoRoot = path.resolve(import.meta.dir, "..");

function pin(overrides: SymbolErcPin): SymbolErcPin {
  return { number: "1", name: "N", electricalType: "passive", unit: 1, ...overrides };
}

function symbolOf(id: string, pins: SymbolErcPin[]): SymbolErcInput {
  return { id, normalized: { pins } };
}

function severities(findings: GateFinding[], severity: GateSeverity): GateFinding[] {
  return findings.filter((f) => f.severity === severity);
}

describe("checkSymbolErc — unknown electricalType", () => {
  test("known type passes", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [pin({ electricalType: "input" })]),
      { category: "ic", generic: false },
    );
    expect(findings.some((f) => f.message.includes("unknown electricalType"))).toBe(false);
  });

  test("unrecognized type warns", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [pin({ electricalType: "quantum_flux" })]),
      { category: "ic", generic: false },
    );
    expect(findings.some((f) => f.severity === "warn" && f.message.includes("quantum_flux"))).toBe(true);
  });
});

describe("checkSymbolErc — missing power_in", () => {
  const opts: SymbolErcOptions = { category: "ic", generic: false };

  test("has a power_in pin: no warn", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [pin({ electricalType: "power_in" }), pin({ number: "2", electricalType: "output" })]),
      opts,
    );
    expect(severities(findings, "warn").some((f) => f.message.includes("no power_in pin"))).toBe(false);
  });

  test("no power_in pin: warns", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [pin({ electricalType: "input" }), pin({ number: "2", electricalType: "output" })]),
      opts,
    );
    expect(severities(findings, "warn").some((f) => f.message.includes("no power_in pin"))).toBe(true);
  });

  test("exempt symbol id: no warn even without power_in", () => {
    const id = [...POWER_IN_EXEMPT_SYMBOL_IDS][0]!;
    const findings = checkSymbolErc(symbolOf(id, [pin({ electricalType: "passive" })]), opts);
    expect(severities(findings, "warn").some((f) => f.message.includes("no power_in pin"))).toBe(false);
  });

  test("generic component: no warn even without power_in", () => {
    const findings = checkSymbolErc(symbolOf("s.ic.x", [pin({ electricalType: "passive" })]), {
      category: "ic",
      generic: true,
    });
    expect(severities(findings, "warn").some((f) => f.message.includes("no power_in pin"))).toBe(false);
  });

  test("category outside {ic,power,sensor}: no warn even without power_in", () => {
    const findings = checkSymbolErc(symbolOf("s.opto.x", [pin({ electricalType: "passive" })]), {
      category: "opto",
      generic: false,
    });
    expect(severities(findings, "warn").some((f) => f.message.includes("no power_in pin"))).toBe(false);
  });
});

describe("checkSymbolErc — blank pin names", () => {
  test("FUNCTION category, all named: no warn", () => {
    const findings = checkSymbolErc(symbolOf("s.ic.x", [pin({ name: "VCC" })]), {
      category: "ic",
      generic: false,
    });
    expect(severities(findings, "warn").some((f) => f.message.includes("blank name"))).toBe(false);
  });

  test("FUNCTION category, blank names: warns listing pin numbers", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [pin({ number: "1", name: "" }), pin({ number: "2", name: "  " })]),
      { category: "ic", generic: false },
    );
    const warning = severities(findings, "warn").find((f) => f.message.includes("blank name"));
    expect(warning?.message).toContain("1, 2");
  });

  test("generic component: no warn", () => {
    const findings = checkSymbolErc(symbolOf("s.ic.x", [pin({ name: "" })]), {
      category: "ic",
      generic: true,
    });
    expect(severities(findings, "warn").some((f) => f.message.includes("blank name"))).toBe(false);
  });

  test("non-FUNCTION category (connector): no warn", () => {
    const findings = checkSymbolErc(symbolOf("s.connector.x", [pin({ name: "" })]), {
      category: "connector",
      generic: false,
    });
    expect(severities(findings, "warn").some((f) => f.message.includes("blank name"))).toBe(false);
  });
});

describe("checkSymbolErc — duplicate signal names", () => {
  const opts: SymbolErcOptions = { category: "ic", generic: false };

  test("same name, stacked at one coordinate: no warn", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", name: "D0", electricalType: "input", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", name: "D0", electricalType: "input", localPosition: { x: 0, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "note").some((f) => f.message.includes("duplicate signal name"))).toBe(false);
  });

  test("same name, different coordinates, non-exempt type: warns", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", name: "RSVD", electricalType: "input", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", name: "RSVD", electricalType: "input", localPosition: { x: 1, y: 0 } }),
      ]),
      opts,
    );
    const warning = severities(findings, "note").find((f) => f.message.includes("duplicate signal name"));
    expect(warning?.message).toContain("1, 2");
  });

  test("same name, different coordinates, exempt type (power_in): no warn", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", name: "GND", electricalType: "power_in", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", name: "GND", electricalType: "power_in", localPosition: { x: 1, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "warn").some((f) => f.message.includes("duplicate signal name"))).toBe(false);
  });
});

describe("checkSymbolErc — stacked output/power_in shorts", () => {
  const opts: SymbolErcOptions = { category: "ic", generic: false };

  test("two outputs at different coordinates: no fail", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", electricalType: "output", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", electricalType: "output", localPosition: { x: 1, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "fail")).toHaveLength(0);
  });

  test("two outputs stacked at one coordinate: fails (output short)", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", electricalType: "output", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", electricalType: "output", localPosition: { x: 0, y: 0 } }),
      ]),
      opts,
    );
    const failure = severities(findings, "fail").find((f) => f.message.includes("output short"));
    expect(failure).toBeDefined();
  });

  test("power_in + output stacked: fails", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", electricalType: "power_in", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", electricalType: "output", localPosition: { x: 0, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "fail").length).toBeGreaterThan(0);
  });

  test("power_in + passive stacked (GND idiom): no fail", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", electricalType: "power_in", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", electricalType: "passive", localPosition: { x: 0, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "fail")).toHaveLength(0);
  });

  test("units are independent — cross-unit stacking is not this gate's concern", () => {
    const findings = checkSymbolErc(
      symbolOf("s.ic.x", [
        pin({ number: "1", unit: 1, electricalType: "output", localPosition: { x: 0, y: 0 } }),
        pin({ number: "2", unit: 2, electricalType: "output", localPosition: { x: 0, y: 0 } }),
      ]),
      opts,
    );
    expect(severities(findings, "fail")).toHaveLength(0);
  });
});

describe("checkNoConnectPads", () => {
  const symbolPins: NoConnectSymbolPin[] = [
    { number: "1", electricalType: "output" },
    { number: "2", electricalType: "no_connect" },
  ];

  test("no_connect pin alone on its pad: note only, no fail", () => {
    const component: NoConnectComponentInput = {
      id: "c.x",
      footprints: [
        {
          footprint: "fp.x",
          pinMap: [
            { pinNumber: "1", padNumber: "1" },
            { pinNumber: "2", padNumber: "2" },
          ],
        },
      ],
    };
    const findings = checkNoConnectPads(component, symbolPins);
    expect(severities(findings, "fail")).toHaveLength(0);
    expect(severities(findings, "note").some((f) => f.message.includes("pad 2"))).toBe(true);
  });

  test("no_connect pin sharing a pad with a connected pin: fails", () => {
    const component: NoConnectComponentInput = {
      id: "c.x",
      footprints: [
        {
          footprint: "fp.x",
          pinMap: [
            { pinNumber: "1", padNumber: "9" },
            { pinNumber: "2", padNumber: "9" },
          ],
        },
      ],
    };
    const findings = checkNoConnectPads(component, symbolPins);
    expect(severities(findings, "fail").some((f) => f.message.includes("pad 9"))).toBe(true);
  });

  test("no pinMap at all: no findings", () => {
    const component: NoConnectComponentInput = { id: "c.x", footprints: [{ footprint: "fp.x" }] };
    expect(checkNoConnectPads(component, symbolPins)).toHaveLength(0);
  });
});

// --- real-tree sweep -------------------------------------------------------
// FUNCTION_CATEGORIES / generic-id knowledge mirrors tools/gates/symbol-erc.ts
// (kept independent here on purpose — this test is the tripwire that would
// catch the two definitions drifting apart, not a place to import the gate's
// own constants and test them against themselves).
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

const KNOWN_GENERIC_SYMBOL_IDS = new Set([
  "openpcb.core.symbol.transistor.nmos-gsd",
  "openpcb.core.symbol.transistor.npn-ebc",
  "openpcb.core.symbol.transistor.pnp-ebc",
  "openpcb.core.symbol.diode.generic",
  "openpcb.core.symbol.diode.zener",
  "openpcb.core.symbol.diode.tvs",
  "openpcb.core.symbol.opto.led",
  "openpcb.core.symbol.opto.led-tht",
  "openpcb.core.symbol.sensor.ldr",
  "openpcb.core.symbol.opto.phototransistor",
]);

function walk(root: string, suffix: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, suffix));
    else if (full.endsWith(suffix)) out.push(full);
  }
  return out.sort();
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

interface RealSymbolFile {
  id: string;
  normalized?: { pins?: SymbolErcPin[] };
}

function symbolIdToCategory(id: string): string {
  const prefix = "openpcb.core.symbol.";
  if (!id.startsWith(prefix)) throw new Error(`unexpected symbol id shape: ${id}`);
  return id.slice(prefix.length).split(".")[0] ?? "";
}

describe("checkSymbolErc — real tree", () => {
  test("no symbol produces a fail finding", () => {
    const files = walk(path.join(repoRoot, "symbols"), ".symbol.json");
    expect(files.length).toBeGreaterThan(200); // sanity: the tree loaded

    const warnCountsByCategory = new Map<string, number>();
    const allFailures: string[] = [];

    for (const file of files) {
      const data = loadJson<RealSymbolFile>(file);
      const category = symbolIdToCategory(data.id);
      const generic = !FUNCTION_CATEGORIES.has(category) || KNOWN_GENERIC_SYMBOL_IDS.has(data.id);
      const findings = checkSymbolErc(data, { category, generic });

      for (const f of findings) {
        if (f.severity === "fail") allFailures.push(`${data.id}: ${f.message}`);
        if (f.severity === "warn") warnCountsByCategory.set(category, (warnCountsByCategory.get(category) ?? 0) + 1);
      }
    }

    console.log("[G9] warn counts by category:", Object.fromEntries(warnCountsByCategory));
    expect(allFailures).toEqual([]);
  });
});

interface RealComponentFile {
  id: string;
  symbol: string;
  footprints: Array<{ footprint: string; pinMap?: Array<{ pinNumber: string; padNumber: string }> }>;
}

describe("checkNoConnectPads — real tree", () => {
  test("no component produces a fail finding", () => {
    const symbolFiles = walk(path.join(repoRoot, "symbols"), ".symbol.json");
    const pinsBySymbolId = new Map<string, NoConnectSymbolPin[]>();
    for (const file of symbolFiles) {
      const data = loadJson<RealSymbolFile>(file);
      const pins = (data.normalized?.pins ?? [])
        .filter((p): p is SymbolErcPin & { number: string; electricalType: string } =>
          typeof p.number === "string" && typeof p.electricalType === "string",
        )
        .map((p) => ({ number: p.number, electricalType: p.electricalType }));
      pinsBySymbolId.set(data.id, pins);
    }

    const componentFiles = walk(path.join(repoRoot, "components"), ".component.json");
    expect(componentFiles.length).toBeGreaterThan(200); // sanity: the tree loaded

    const allFailures: string[] = [];
    for (const file of componentFiles) {
      const data = loadJson<RealComponentFile>(file);
      const symbolPins = pinsBySymbolId.get(data.symbol);
      if (!symbolPins) continue; // unknown symbol ref is G-nothing-here's problem, not G9's
      const findings = checkNoConnectPads({ id: data.id, footprints: data.footprints }, symbolPins);
      for (const f of findings) {
        if (f.severity === "fail") allFailures.push(`${data.id}: ${f.message}`);
      }
    }

    expect(allFailures).toEqual([]);
  });
});
