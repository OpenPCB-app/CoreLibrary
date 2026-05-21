import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

function makeTempLibrary(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "openpcb-core-validate-test-"));
  tempDirs.push(dir);
  for (const name of ["symbols", "footprints", "components", "schemas", "3d"] as const) {
    cpSync(path.join(repoRoot, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readJson<T>(root: string, relPath: string): T {
  return JSON.parse(readFileSync(path.join(root, relPath), "utf8")) as T;
}

function writeJson(root: string, relPath: string, data: unknown): void {
  writeFileSync(path.join(root, relPath), `${JSON.stringify(data, null, 2)}\n`);
}

async function runValidate(root: string, args: string[] = []): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "tools/validate.ts", ...args],
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

type Component = {
  name?: string;
  category?: string;
  footprints: Array<{ pinMap?: Array<{ pinNumber: string; padNumber: string; pinName?: string }> }>;
};

type SymbolJson = {
  normalized?: { pins?: Array<{ number?: string; unit?: number; name?: string }> };
};

type Footprint = {
  models3d?: string[];
};

describe("source-tree integrity validation", () => {
  test("accepts the canonical source tree", async () => {
    const root = makeTempLibrary();

    const result = await runValidate(root);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("[validate] OK");
  });

  test("rejects component pinMap entries with unknown symbol pins", async () => {
    const root = makeTempLibrary();
    const rel = "components/passive/resistor.component.json";
    const component = readJson<Component>(root, rel);
    component.footprints[0]!.pinMap![0]!.pinNumber = "99";
    writeJson(root, rel, component);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown symbol pin 99");
  });

  test("rejects component pinMap entries with unknown footprint pads", async () => {
    const root = makeTempLibrary();
    const rel = "components/passive/resistor.component.json";
    const component = readJson<Component>(root, rel);
    component.footprints[0]!.pinMap![0]!.padNumber = "99";
    writeJson(root, rel, component);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown footprint pad 99");
  });

  test("rejects footprint 3D model references that are not present", async () => {
    const root = makeTempLibrary();
    const rel = "footprints/passive/r-0603.fp.json";
    const footprint = readJson<Footprint>(root, rel);
    footprint.models3d = ["openpcb.core.3d.passive.missing-model"];
    writeJson(root, rel, footprint);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown 3d model ref");
  });

  test("release validation requires STEP-backed models on all referenced footprints", async () => {
    const root = makeTempLibrary();
    const rel = "footprints/passive/r-0603.fp.json";
    const footprint = readJson<Footprint>(root, rel);
    footprint.models3d = [];
    writeJson(root, rel, footprint);

    const result = await runValidate(root, ["--release"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("release validation requires STEP-backed 3d model");
  });

  test("strict validation rejects duplicate component names", async () => {
    const root = makeTempLibrary();
    const rel = "components/passive/inductor.component.json";
    const component = readJson<Component>(root, rel);
    component.name = "Resistor";
    writeJson(root, rel, component);

    const result = await runValidate(root, ["--strict"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("duplicate component name");
  });

  test("rejects category folder mismatches", async () => {
    const root = makeTempLibrary();
    const rel = "components/passive/inductor.component.json";
    const component = readJson<Component>(root, rel);
    component.category = "ic";
    writeJson(root, rel, component);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("category field ic does not match folder passive");
  });

  test("rejects duplicate symbol pins within a unit", async () => {
    const root = makeTempLibrary();
    const rel = "symbols/passive/resistor.symbol.json";
    const symbol = readJson<SymbolJson>(root, rel);
    const firstPin = symbol.normalized?.pins?.[0];
    if (!firstPin || !symbol.normalized?.pins) throw new Error("missing fixture pin");
    symbol.normalized.pins.push({ ...firstPin });
    writeJson(root, rel, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("duplicate symbol pin number");
  });
});
