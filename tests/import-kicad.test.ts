import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "openpcb-core-import-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function symbolFixture(pin2 = "2"): string {
  return `(kicad_symbol_lib
    (version 20231120) (generator "openpcb_test")
    (symbol "R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.016 -2.54) (end 1.016 2.54)
          (stroke (width 0) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "1" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27)
          (name "${pin2}" (effects (font (size 1.27 1.27))))
          (number "${pin2}" (effects (font (size 1.27 1.27))))))))`;
}

const footprintFixture = `(footprint "R_0603_1608Metric"
  (version 20231120)
  (generator "openpcb_test")
  (layer "F.Cu")
  (descr "Resistor SMD 0603")
  (tags "resistor smd")
  (property "Reference" "REF**" (at 0 -1.43 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "R_0603_1608Metric" (at 0 1.43 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (attr smd)
  (fp_rect (start -0.8 -0.4) (end 0.8 0.4)
    (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))
  (pad "1" smd roundrect (at -0.775 0) (size 0.9 0.95)
    (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" smd roundrect (at 0.775 0) (size 0.9 0.95)
    (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (model "\${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step"
    (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`;

function writeFixtures(dir: string, mismatch = false): { symbol: string; footprint: string; step: string } {
  const symbol = path.join(dir, "simple_resistor.kicad_sym");
  const footprint = path.join(dir, "R_0603_1608Metric.kicad_mod");
  const step = path.join(dir, "R_0603_1608Metric.step");
  writeFileSync(symbol, symbolFixture(mismatch ? "3" : "2"));
  writeFileSync(footprint, footprintFixture);
  writeFileSync(step, "ISO-10303-21;\nEND-ISO-10303-21;\n");
  return { symbol, footprint, step };
}

async function runImport(files: { symbol: string; footprint: string; step: string }, out: string) {
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "tools/import-kicad.ts",
      "--component=resistor",
      `--symbol=${files.symbol}`,
      `--footprint=${files.footprint}`,
      `--step=${files.step}`,
      `--out=${out}`,
    ],
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

function containsKiCadSource(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && containsKiCadSource(full)) return true;
    if (entry.isFile() && (entry.name.endsWith(".kicad_sym") || entry.name.endsWith(".kicad_mod"))) return true;
  }
  return false;
}

async function runValidate(root: string): Promise<string> {
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
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  return stdout;
}

describe("KiCad import wrapper", () => {
  test("imports symbol, footprint, component, and STEP model metadata", async () => {
    const dir = makeTempDir();
    const files = writeFixtures(dir);
    const out = path.join(dir, "out");

    const result = await runImport(files, out);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(out, "symbols/passive/resistor.symbol.json"))).toBe(true);
    expect(existsSync(path.join(out, "footprints/passive/r-0603-1608metric.fp.json"))).toBe(true);
    expect(existsSync(path.join(out, "components/passive/resistor.component.json"))).toBe(true);
    expect(existsSync(path.join(out, "3d/passive/r-0603-1608metric.step"))).toBe(true);
    expect(existsSync(path.join(out, "3d/passive/r-0603-1608metric.model.json"))).toBe(true);
    expect(containsKiCadSource(out)).toBe(false);

    const component = JSON.parse(readFileSync(path.join(out, "components/passive/resistor.component.json"), "utf8"));
    expect(component.provenance.source).toBe("kicad-derived");
    expect(component.provenance.license).toBe("CC-BY-SA-4.0+KiCad-Libraries-Exception");
    await expect(runValidate(out)).resolves.toContain("[validate] OK");
  });

  test("rejects symbol pin and footprint pad mismatches", async () => {
    const dir = makeTempDir();
    const files = writeFixtures(dir, true);
    const out = path.join(dir, "out");

    const result = await runImport(files, out);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("pin numbers not present");
    expect(existsSync(out)).toBe(false);
  });
});
