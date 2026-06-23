import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

interface TestManifest {
  version: string;
  components: Array<{
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
    manufacturerParts?: Array<{ manufacturer: string; mpn: string }>;
    symbol: { id: string; path: string };
    defaultFootprint: string;
    footprints: Array<{
      id: string;
      path: string;
      label: string;
      model: { id: string; path: string };
      pinMap?: Array<{
        pinNumber: string;
        padNumber: string;
        pinName?: string;
      }>;
    }>;
  }>;
}

function makeTempDir(): string {
  const dir = mkdtempSync(
    path.join(tmpdir(), "openpcb-core-batch-import-test-"),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const symbolFixture = `(kicad_symbol_lib
  (version 20231120) (generator "openpcb_test")
  (symbol "D"
    (property "Reference" "D" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "D" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (symbol "D_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "K" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -3.81 90) (length 1.27)
        (name "A" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const symbolWithDatasheetFixture = `(kicad_symbol_lib
  (version 20231120) (generator "openpcb_test")
  (symbol "D_DS"
    (property "Reference" "D" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "D_DS" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "https://example.com/d.pdf" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
    (symbol "D_DS_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "K" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -3.81 90) (length 1.27)
        (name "A" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const parentSymbolFixture = `(kicad_symbol_lib
  (version 20231120) (generator "openpcb_test")
  (symbol "Parent"
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Parent" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (symbol "Parent_1_1"
      (pin input line (at -2.54 0 0) (length 1.27)
        (name "A" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 2.54 0 180) (length 1.27)
        (name "Y" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))
    (symbol "Parent_1_1_AliasDuplicate"
      (pin input line (at -2.54 0 0) (length 1.27)
        (name "A" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 2.54 0 180) (length 1.27)
        (name "Y" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const childSymbolFixture = `(kicad_symbol_lib
  (version 20231120) (generator "openpcb_test")
  (symbol "Child" (extends "Parent")
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Child" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))))`;

const footprintFixture = `(footprint "D_SOD-123"
  (version 20231120)
  (generator "openpcb_test")
  (layer "F.Cu")
  (descr "Diode SOD-123")
  (tags "diode smd")
  (property "Reference" "REF**" (at 0 -1.43 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "D_SOD-123" (at 0 1.43 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (attr smd)
  (fp_rect (start -1 -0.6) (end 1 0.6)
    (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))
  (pad "1" smd roundrect (at -1.5 0) (size 1 1)
    (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" smd roundrect (at 1.5 0) (size 1 1)
    (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (model "\${KICAD10_3DMODEL_DIR}/Diode_SMD.3dshapes/D_SOD-123.step"
    (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`;

function writeFixtureTree(root: string): void {
  const symbolDir = path.join(root, "symbols");
  const footprintDir = path.join(root, "footprints");
  const modelDir = path.join(root, "models");
  rmSync(symbolDir, { recursive: true, force: true });
  rmSync(footprintDir, { recursive: true, force: true });
  rmSync(modelDir, { recursive: true, force: true });
  mkdirSync(symbolDir, { recursive: true });
  mkdirSync(footprintDir, { recursive: true });
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(path.join(symbolDir, "D.kicad_sym"), symbolFixture);
  writeFileSync(
    path.join(symbolDir, "D_DS.kicad_sym"),
    symbolWithDatasheetFixture,
  );
  writeFileSync(path.join(symbolDir, "Parent.kicad_sym"), parentSymbolFixture);
  writeFileSync(path.join(symbolDir, "Child.kicad_sym"), childSymbolFixture);
  writeFileSync(
    path.join(footprintDir, "D_SOD-123.kicad_mod"),
    footprintFixture,
  );
  writeFileSync(
    path.join(modelDir, "D_SOD-123.step"),
    "ISO-10303-21;\nEND-ISO-10303-21;\n",
  );
  writeFileSync(
    path.join(modelDir, "Other.step"),
    "ISO-10303-21;\nEND-ISO-10303-21;\n",
  );
}

function manifest(pinNumber = "1"): TestManifest {
  return {
    version: "1.0.0",
    components: [
      {
        id: "openpcb.core.diode.test",
        name: "Test Diode",
        description: "Test diode imported from fixture files.",
        category: "diode",
        tags: ["diode", "test"],
        symbol: {
          id: "openpcb.core.symbol.diode.test",
          path: "symbols/D.kicad_sym",
        },
        defaultFootprint: "openpcb.core.footprint.diode.d-sod-123-test",
        footprints: [
          {
            id: "openpcb.core.footprint.diode.d-sod-123-test",
            path: "footprints/D_SOD-123.kicad_mod",
            label: "SOD-123",
            model: {
              id: "openpcb.core.3d.diode.d-sod-123-test",
              path: "models/D_SOD-123.step",
            },
            pinMap: [
              { pinNumber, padNumber: "1", pinName: "K" },
              { pinNumber: "2", padNumber: "2", pinName: "A" },
            ],
          },
        ],
      },
    ],
  };
}

async function runBatch(args: string[]) {
  const proc = Bun.spawn({
    cmd: ["bun", "tools/import-kicad-batch.ts", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runValidate(
  root: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "tools/validate.ts"],
    cwd: repoRoot,
    env: { ...process.env, CORELIB_ROOT: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("KiCad batch importer", () => {
  test("resolves inherited symbols without duplicate pins and records source files", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const data = manifest();
    data.components[0]!.symbol = {
      id: "openpcb.core.symbol.diode.test",
      path: "symbols/Child.kicad_sym",
    };
    data.components[0]!.footprints[0]!.pinMap = [
      { pinNumber: "1", padNumber: "1", pinName: "A" },
      { pinNumber: "2", padNumber: "2", pinName: "Y" },
    ];
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--strict",
      "--converted-at=2026-05-21T00:00:00.000Z",
    ]);
    const symbol = JSON.parse(
      readFileSync(path.join(out, "symbols/diode/test.symbol.json"), "utf8"),
    ) as {
      normalized: { pins: Array<{ number: string; unit: number }> };
      parser: { sourceFiles: Array<{ fileName: string }> };
    };
    const pinKeys = symbol.normalized.pins.map(
      (pin) => `${pin.unit}:${pin.number}`,
    );

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(pinKeys).toEqual(["1:1", "1:2"]);
    expect(symbol.parser.sourceFiles.map((item) => item.fileName)).toEqual([
      "Child.kicad_sym",
      "Parent.kicad_sym",
    ]);
  });

  test("dry-run validates without writing files", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--dry-run",
      "--converted-at=2026-05-21T00:00:00.000Z",
    ]);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("validated 1 components");
    expect(existsSync(path.join(out, "components"))).toBe(false);
  });

  test("writes a valid CoreLibrary source tree", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--converted-at=2026-05-21T00:00:00.000Z",
    ]);
    const validation = await runValidate(out);
    const component = JSON.parse(
      readFileSync(
        path.join(out, "components/diode/test.component.json"),
        "utf8",
      ),
    ) as { id: string };

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(component.id).toBe("openpcb.core.diode.test");
    expect(
      validation.exitCode,
      `${validation.stdout}\n${validation.stderr}`,
    ).toBe(0);
  });

  test("rejects pin maps with unknown symbol pins", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest("99"), null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--dry-run",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown symbol pin 99");
  });

  test("strict mode requires explicit pin maps", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const data = manifest();
    data.components[0]!.footprints[0]!.pinMap = undefined;
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--dry-run",
      "--strict",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("strict mode requires explicit pinMap");
  });

  test("strict mode requires footprint STEP reference to match manifest model", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const data = manifest();
    data.components[0]!.footprints[0]!.model.path = "models/Other.step";
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--dry-run",
      "--strict",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("strict mode requires footprint");
  });

  test("refuses to overwrite output files unless allowed", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);

    const first = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
    ]);
    const second = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
    ]);
    const third = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--allow-overwrite",
    ]);

    expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr).toContain("output path already exists");
    expect(third.exitCode, `${third.stdout}\n${third.stderr}`).toBe(0);
  });

  test("passes through metadata fields into the component", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const data = manifest();
    const component = data.components[0]!;
    component.subcategory = "schottky";
    component.keywords = ["SS14", "DO-214AC"];
    component.parameters = { reverse_voltage: "40V", forward_current: "1A" };
    component.datasheet = "https://example.com/explicit.pdf";
    component.manufacturerParts = [{ manufacturer: "Diodes Inc", mpn: "SS14" }];
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--converted-at=2026-05-21T00:00:00.000Z",
    ]);
    const written = JSON.parse(
      readFileSync(
        path.join(out, "components/diode/test.component.json"),
        "utf8",
      ),
    ) as {
      subcategory?: string;
      keywords?: string[];
      parameters?: Record<string, unknown>;
      datasheet?: string | null;
      manufacturerParts?: Array<{ manufacturer: string; mpn: string }>;
    };

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(written.subcategory).toBe("schottky");
    expect(written.keywords).toEqual(["SS14", "DO-214AC"]);
    expect(written.parameters).toEqual({
      reverse_voltage: "40V",
      forward_current: "1A",
    });
    expect(written.datasheet).toBe("https://example.com/explicit.pdf");
    expect(written.manufacturerParts).toEqual([
      { manufacturer: "Diodes Inc", mpn: "SS14" },
    ]);
  });

  test("captures the KiCad symbol Datasheet property into datasheetSource", async () => {
    const root = makeTempDir();
    const out = makeTempDir();
    writeFixtureTree(root);
    const data = manifest();
    data.components[0]!.symbol = {
      id: "openpcb.core.symbol.diode.test",
      path: "symbols/D_DS.kicad_sym",
    };
    const manifestPath = path.join(root, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);

    const result = await runBatch([
      `--manifest=${manifestPath}`,
      `--kicad-root=${root}`,
      `--out=${out}`,
      "--converted-at=2026-05-21T00:00:00.000Z",
    ]);
    const written = JSON.parse(
      readFileSync(
        path.join(out, "components/diode/test.component.json"),
        "utf8",
      ),
    ) as { datasheetSource?: string };

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(written.datasheetSource).toBe("https://example.com/d.pdf");
  });
});
