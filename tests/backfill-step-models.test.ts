import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "openpcb-core-step-backfill-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureFootprint(id = "openpcb.core.footprint.passive.r-0603", name = "R_0603_1608Metric") {
  return {
    id,
    uuid: "5df9abe4-3450-5f01-84b0-781379a722bf",
    version: "1.0.0",
    name,
    mountType: "smd",
    provenance: { source: "openpcb-original", license: "test" },
    normalized: { preview: { pads: [{ number: "1" }, { number: "2" }] } },
  };
}

function manifest(stepSource = "kicad-packages3D/Resistor_SMD.3dshapes/R_0603_1608Metric.step") {
  return {
    version: "1.0.0",
    entries: [
      {
        footprintId: "openpcb.core.footprint.passive.r-0603",
        footprintPath: "footprints/passive/r-0603.fp.json",
        modelId: "openpcb.core.3d.passive.r-0603",
        modelName: "R_0603_1608Metric STEP model",
        stepSource,
        stepOutput: "3d/passive/r-0603.step",
      },
    ],
  };
}

function writeFixtureTree(root: string, kicadRoot: string): string {
  mkdirSync(path.join(root, "footprints/passive"), { recursive: true });
  mkdirSync(path.join(kicadRoot, "kicad-packages3D/Resistor_SMD.3dshapes"), { recursive: true });
  writeFileSync(path.join(root, "footprints/passive/r-0603.fp.json"), `${JSON.stringify(fixtureFootprint(), null, 2)}\n`);
  writeFileSync(path.join(kicadRoot, "kicad-packages3D/Resistor_SMD.3dshapes/R_0603_1608Metric.step"), "ISO-10303-21;\nEND-ISO-10303-21;\n");
  const manifestPath = path.join(root, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`);
  return manifestPath;
}

async function runBackfill(args: string[]) {
  const proc = Bun.spawn({
    cmd: ["bun", "tools/backfill-step-models.ts", ...args],
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

describe("STEP model backfill", () => {
  test("dry-run validates without writing files", async () => {
    const root = makeTempDir();
    const kicadRoot = makeTempDir();
    const manifestPath = writeFixtureTree(root, kicadRoot);

    const result = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`, "--dry-run", "--strict"]);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("validated 1 STEP model backfills");
    expect(existsSync(path.join(root, "3d/passive/r-0603.model.json"))).toBe(false);
  });

  test("writes model sidecar, STEP, and footprint model reference", async () => {
    const root = makeTempDir();
    const kicadRoot = makeTempDir();
    const manifestPath = writeFixtureTree(root, kicadRoot);

    const result = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`, "--strict"]);
    const model = JSON.parse(readFileSync(path.join(root, "3d/passive/r-0603.model.json"), "utf8")) as { id: string; formats: { step: { path: string } } };
    const footprint = JSON.parse(readFileSync(path.join(root, "footprints/passive/r-0603.fp.json"), "utf8")) as { models3d: string[] };

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(model.id).toBe("openpcb.core.3d.passive.r-0603");
    expect(model.formats.step.path).toBe("3d/passive/r-0603.step");
    expect(footprint.models3d).toEqual(["openpcb.core.3d.passive.r-0603"]);
    expect(existsSync(path.join(root, "3d/passive/r-0603.step"))).toBe(true);
  });

  test("strict mode rejects footprint/model name mismatches", async () => {
    const root = makeTempDir();
    const kicadRoot = makeTempDir();
    const manifestPath = writeFixtureTree(root, kicadRoot);
    writeFileSync(path.join(root, "footprints/passive/r-0603.fp.json"), `${JSON.stringify(fixtureFootprint(undefined, "R_0805_2012Metric"), null, 2)}\n`);

    const result = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`, "--dry-run", "--strict"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("footprint/model name mismatch");
  });

  test("refuses to overwrite existing outputs unless allowed", async () => {
    const root = makeTempDir();
    const kicadRoot = makeTempDir();
    const manifestPath = writeFixtureTree(root, kicadRoot);

    const first = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`]);
    const second = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`]);
    const third = await runBackfill([`--manifest=${manifestPath}`, `--kicad-root=${kicadRoot}`, `--out=${root}`, "--allow-overwrite"]);

    expect(first.exitCode, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr).toContain("output path already exists");
    expect(third.exitCode, `${third.stdout}\n${third.stderr}`).toBe(0);
  });
});
