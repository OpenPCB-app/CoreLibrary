import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkRequiredParameters,
  type RequiredParametersInput,
} from "../tools/gates/parameters-required";
import { REPO_ROOT, loadJson, walkFiles } from "../tools/lib";

describe("checkRequiredParameters — generic / out-of-scope skips", () => {
  test("a known generic component is skipped entirely, even with no parameters", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.transistor.npn-sot-23-ebc",
      category: "transistor",
    });
    expect(findings).toEqual([]);
  });

  test("a non-function category is skipped entirely", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.connector.some-header",
      category: "connector",
    });
    expect(findings).toEqual([]);
  });

  test("no category at all is skipped", () => {
    const findings = checkRequiredParameters({ id: "openpcb.core.mystery.thing" });
    expect(findings).toEqual([]);
  });
});

describe("checkRequiredParameters — empty parameters", () => {
  test("empty parameters object on a function category warns once, listing required keys", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.ic.some-chip",
      category: "ic",
      parameters: {},
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.gate).toBe("G6");
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.message).toContain("type");
  });

  test("missing parameters entirely on a function category warns once", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.sensor.some-sensor",
      category: "sensor",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("measures");
  });
});

describe("checkRequiredParameters — always-required keys", () => {
  test("missing an always-required key warns", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.sensor.some-sensor",
      category: "sensor",
      parameters: { type: "temperature", interface: "i2c", supply: "3.3V" },
    });
    expect(findings.some((f) => f.severity === "warn" && f.message.includes("measures"))).toBe(
      true,
    );
  });

  test("all always-required keys present -> no findings for a category with no byType table", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.relay.some-relay",
      category: "relay",
      parameters: { type: "spdt", coil_voltage: "5V", contacts: "SPDT" },
    });
    expect(findings).toEqual([]);
  });
});

describe("checkRequiredParameters — type enum", () => {
  test("a type value outside PARAMETER_TYPE_VALUES warns", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.transistor.some-transistor",
      category: "transistor",
      parameters: { type: "igbt" },
    });
    expect(
      findings.some((f) => f.severity === "warn" && f.message.includes("not a recognized")),
    ).toBe(true);
  });

  test("a type value in the enum but with no byType table (e.g. power/shunt) does not warn on type", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.power.some-reference",
      category: "power",
      parameters: { type: "shunt" },
    });
    expect(findings.some((f) => f.message.includes("not a recognized"))).toBe(false);
  });

  test("a category with no PARAMETER_TYPE_VALUES entry (e.g. audio) never warns on type value", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.audio.some-buzzer",
      category: "audio",
      parameters: { type: "anything-goes" },
    });
    expect(findings).toEqual([]);
  });
});

describe("checkRequiredParameters — byType required keys", () => {
  test("transistor/npn missing vce and ic warns for both", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.transistor.some-npn",
      category: "transistor",
      parameters: { type: "npn" },
    });
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("'vce'"))).toBe(true);
    expect(messages.some((m) => m.includes("'ic'"))).toBe(true);
  });

  test("transistor/nmos requires vds, id, rds_on", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.transistor.some-nmos",
      category: "transistor",
      parameters: { type: "nmos", vds: "30V" },
    });
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("'id'"))).toBe(true);
    expect(messages.some((m) => m.includes("'rds_on'"))).toBe(true);
    expect(messages.some((m) => m.includes("'vds'"))).toBe(false);
  });

  test("diode/tvs requires nothing beyond type", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.diode.some-tvs",
      category: "diode",
      parameters: { type: "tvs" },
    });
    expect(findings).toEqual([]);
  });

  test("diode/zener requires only vz", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.diode.some-zener",
      category: "diode",
      parameters: { type: "zener", vz: "5.1V" },
    });
    expect(findings).toEqual([]);
  });

  test("power/charger requires vbat and ichg, not vin_max/vout/iout", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.power.some-charger",
      category: "power",
      parameters: { type: "charger", vbat: "4.2V", ichg: "1A" },
    });
    expect(findings).toEqual([]);
  });

  test("a fully-satisfied function part has no findings", () => {
    const findings = checkRequiredParameters({
      id: "openpcb.core.transistor.some-bjt",
      category: "transistor",
      parameters: { type: "npn", vce: "40V", ic: "200mA" },
    });
    expect(findings).toEqual([]);
  });
});

describe("checkRequiredParameters — real tree", () => {
  test("no unexpected exceptions; log per-category warn counts", () => {
    const componentsRoot = path.join(REPO_ROOT, "components");
    const byCategory = new Map<string, number>();
    let total = 0;

    for (const file of walkFiles(componentsRoot, ".component.json")) {
      const data = loadJson<RequiredParametersInput & { category?: string }>(file);
      const findings = checkRequiredParameters(data);
      // G6 is advisory-only by design: fail is never emitted.
      expect(findings.every((f) => f.severity === "warn")).toBe(true);
      if (findings.length > 0 && data.category) {
        byCategory.set(data.category, (byCategory.get(data.category) ?? 0) + findings.length);
        total += findings.length;
      }
    }

    console.log(`[G6 real-tree] total warns=${total}`, Object.fromEntries(byCategory));
    // Every non-generic function part now carries its headline parameters, so the
    // tree is expected to be clean. This locks that in: a new component landing
    // without its required keys re-opens the gap and fails here.
    expect(Object.fromEntries(byCategory)).toEqual({});
    expect(total).toBe(0);
  });
});
