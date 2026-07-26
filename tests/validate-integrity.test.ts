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

// These gates exist because the library shipped 21 multi-unit symbols whose
// pins were stacked on top of each other — every quad/hex logic gate and
// multi-channel op-amp. A gate that cannot fail is not a gate, so each one is
// exercised against a deliberately broken copy of the real tree.
describe("preview / pin integrity gates", () => {
  type FullSymbol = {
    raw?: unknown;
    normalized?: {
      pins?: Array<{
        number?: string;
        unit?: number;
        name?: string;
        originPinKey?: string;
        localPosition?: { x: number; y: number };
      }>;
      preview?: {
        unitCount?: number;
        pins?: Array<{ id?: string; anchor?: { x: number; y: number } }>;
        labels?: Array<{ fontSizeMm?: number; text?: string }>;
        graphics?: Array<{ layer?: string }>;
      };
    };
  };
  type FullFootprint = {
    raw?: unknown;
    normalized?: { preview?: { graphics?: Array<{ layer?: string }> } };
  };

  const MULTI_UNIT = "symbols/ic/lm324.symbol.json";

  test("G1a — rejects a preview that drops pins", async () => {
    const root = makeTempLibrary();
    const symbol = readJson<FullSymbol>(root, MULTI_UNIT);
    symbol.normalized!.preview!.pins = symbol.normalized!.preview!.pins!.slice(0, 3);
    writeJson(root, MULTI_UNIT, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("every pin must be represented");
  });

  test("G1b — rejects an electrical pin drawn somewhere else", async () => {
    const root = makeTempLibrary();
    const symbol = readJson<FullSymbol>(root, MULTI_UNIT);
    symbol.normalized!.pins![0]!.localPosition = { x: 999, y: 999 };
    writeJson(root, MULTI_UNIT, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("preview and normalized.pins disagree");
  });

  // The original defect: re-stack two units onto one coordinate.
  test("G1c — rejects pins of different units sharing a coordinate", async () => {
    const root = makeTempLibrary();
    const symbol = readJson<FullSymbol>(root, MULTI_UNIT);
    const pins = symbol.normalized!.pins!;
    const u1 = pins.find((p) => p.unit === 1)!;
    const u2 = pins.find((p) => p.unit === 2)!;
    u2.localPosition = { ...u1.localPosition! };
    // Keep the anchors in step so G1b does not mask the collision.
    const anchors = symbol.normalized!.preview!.pins!;
    anchors.find((a) => a.id === u2.originPinKey)!.anchor = {
      ...u1.localPosition!,
    };
    writeJson(root, MULTI_UNIT, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("units must not overlap");
  });

  // Stacking within one unit is a legitimate KiCad idiom (every GND pad drawn
  // at one point), but only for the same signal.
  test("G1d — rejects differently-named pins stacked within a unit", async () => {
    const root = makeTempLibrary();
    const rel = "symbols/ic/esp32-wroom-32.symbol.json";
    const symbol = readJson<FullSymbol>(root, rel);
    const pins = symbol.normalized!.pins!;
    const gnd = pins.filter(
      (p) =>
        p.localPosition &&
        pins.filter(
          (q) =>
            q.localPosition!.x === p.localPosition!.x &&
            q.localPosition!.y === p.localPosition!.y,
        ).length > 1,
    );
    if (gnd.length < 2) throw new Error("fixture has no stacked pins");
    gnd[1]!.name = "NOT_GND";
    writeJson(root, rel, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("pins with different names share coordinate");
  });

  test("G2 — rejects a stub raw blob", async () => {
    const root = makeTempLibrary();
    const rel = "footprints/passive/r-0603.fp.json";
    const footprint = readJson<FullFootprint>(root, rel);
    footprint.raw = { kind: "kicad-footprint", name: "R_0603_1608Metric" };
    writeJson(root, rel, footprint);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no rebuildable raw parse");
  });

  test("G2 — still allows the two OpenPCB-original generic symbols", async () => {
    const root = makeTempLibrary();

    const result = await runValidate(root);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  test("G3 — rejects a footprint with no courtyard", async () => {
    const root = makeTempLibrary();
    const rel = "footprints/passive/r-0603.fp.json";
    const footprint = readJson<FullFootprint>(root, rel);
    footprint.normalized!.preview!.graphics =
      footprint.normalized!.preview!.graphics!.filter(
        (g) => !/CrtYd|Courtyard/.test(g.layer ?? ""),
      );
    writeJson(root, rel, footprint);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no courtyard geometry");
  });

  test("G4 — rejects sub-KLC label text on a multi-unit symbol", async () => {
    const root = makeTempLibrary();
    const symbol = readJson<FullSymbol>(root, MULTI_UNIT);
    symbol.normalized!.preview!.labels![0]!.fontSizeMm = 0.508;
    writeJson(root, MULTI_UNIT, symbol);

    const result = await runValidate(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("re-stack the pins");
  });

  // Small text is faithful KiCad data on single-unit parts (LM386 "GAIN",
  // TL081 "NULL"), so the gate must not fire there.
  test("G4 — allows sub-KLC label text on a single-unit symbol", async () => {
    const root = makeTempLibrary();
    const rel = "symbols/ic/lm386.symbol.json";
    const symbol = readJson<FullSymbol>(root, rel);
    const small = symbol.normalized!.preview!.labels!.filter(
      (l) => typeof l.fontSizeMm === "number" && l.fontSizeMm < 1,
    );
    expect(small.length).toBeGreaterThan(0);

    const result = await runValidate(root);

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
