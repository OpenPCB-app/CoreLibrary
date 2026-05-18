import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  buildInspectResponse,
  commitKicadImport,
  ImportValidationError,
} from "../src/import";

const FIXTURES = path.resolve(
  import.meta.dir,
  "../../kicad-parsers/tests/__fixtures__",
);
const SCHEMAS = path.resolve(import.meta.dir, "../../../schemas");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

function loadSchema(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(SCHEMAS, `${name}.schema.json`), "utf8"),
  );
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv as never);
const validateSymbol = ajv.compile(loadSchema("symbol") as never);
const validateFootprint = ajv.compile(loadSchema("footprint") as never);
const validateComponent = ajv.compile(loadSchema("component") as never);

describe("commitKicadImport — pure", () => {
  test("simple_resistor + C_0603 → schema-valid trio", () => {
    const symLib = readFixture("simple_resistor.kicad_sym");
    const fp = readFixture("C_0603_1608Metric.kicad_mod");

    const inspect = buildInspectResponse({
      symbolLibrary: { fileName: "simple_resistor.kicad_sym", content: symLib },
      footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: fp }],
    });
    expect(inspect.symbols.length).toBeGreaterThan(0);
    expect(inspect.footprints.length).toBe(1);

    const symbolId = inspect.symbols[0]!.id;
    const footprintId = inspect.footprints[0]!.id;

    const out = commitKicadImport({
      symbolLibrary: { fileName: "simple_resistor.kicad_sym", content: symLib },
      footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: fp }],
      selection: { symbolId, footprintId },
      component: {
        name: "Test Resistor 0603",
        description: "Generic 0603 resistor (imported)",
        category: "passive",
        license: "CC-BY-4.0",
        tags: ["resistor"],
      },
    });

    expect(out.symbol).toBeDefined();
    expect(out.footprint).not.toBeNull();
    expect(out.component).toBeDefined();

    // IDs
    expect(out.symbol.id).toBe(
      "openpcb.core.passive.symbol.test-resistor-0603",
    );
    expect(out.footprint!.id).toBe(
      "openpcb.core.passive.footprint.test-resistor-0603",
    );
    expect(out.component.id).toBe("openpcb.core.passive.test-resistor-0603");

    // UUIDs distinct
    expect(out.symbol.uuid).not.toBe(out.footprint!.uuid);
    expect(out.symbol.uuid).not.toBe(out.component.uuid);

    // Provenance license echoed
    expect(out.component.provenance.license).toBe("CC-BY-4.0");
    expect(out.component.provenance.source).toBe("kicad-derived");

    // Component refs match
    expect(out.component.symbol).toBe(out.symbol.id);
    expect(out.component.defaultFootprint).toBe(out.footprint!.id);
    expect(out.component.footprints[0]!.footprint).toBe(out.footprint!.id);

    // Schema validation
    expect(validateSymbol(out.symbol)).toBe(true);
    if (!validateFootprint(out.footprint)) {
      console.log(validateFootprint.errors);
    }
    expect(validateFootprint(out.footprint)).toBe(true);
    if (!validateComponent(out.component)) {
      console.log(validateComponent.errors);
    }
    expect(validateComponent(out.component)).toBe(true);
  });

  test("symbol-only import is rejected (footprints required)", () => {
    const symLib = readFixture("simple_resistor.kicad_sym");
    const inspect = buildInspectResponse({
      symbolLibrary: { fileName: "simple_resistor.kicad_sym", content: symLib },
      footprints: [],
    });
    const symbolId = inspect.symbols[0]!.id;

    expect(() =>
      commitKicadImport({
        symbolLibrary: {
          fileName: "simple_resistor.kicad_sym",
          content: symLib,
        },
        footprints: [],
        selection: { symbolId, footprintId: null },
        component: {
          name: "Test",
          description: "",
          category: "passive",
          license: "MIT",
        },
      }),
    ).toThrow(ImportValidationError);
  });

  test("missing license is rejected", () => {
    const symLib = readFixture("simple_resistor.kicad_sym");
    const fp = readFixture("C_0603_1608Metric.kicad_mod");
    const inspect = buildInspectResponse({
      symbolLibrary: { fileName: "simple_resistor.kicad_sym", content: symLib },
      footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: fp }],
    });
    expect(() =>
      commitKicadImport({
        symbolLibrary: {
          fileName: "simple_resistor.kicad_sym",
          content: symLib,
        },
        footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: fp }],
        selection: {
          symbolId: inspect.symbols[0]!.id,
          footprintId: inspect.footprints[0]!.id,
        },
        component: {
          name: "x",
          description: "",
          category: "passive",
          license: "",
        },
      }),
    ).toThrow(ImportValidationError);
  });
});
