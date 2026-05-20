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
  for (const name of ["symbols", "footprints", "components", "schemas"] as const) {
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

async function runValidate(root: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

type Component = {
  footprints: Array<{ pinMap?: Array<{ pinNumber: string; padNumber: string; pinName?: string }> }>;
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
});
