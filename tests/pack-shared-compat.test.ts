import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import { OpclibFormatError, readOpclibFromPath } from "@openpcb/opclib-pack";

const repoRoot = path.resolve(import.meta.dir, "..");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "openpcb-core-pack-test-"));
  tempDirs.push(dir);
  return dir;
}

async function runPack(
  version: string,
  outDir: string,
  extraArgs: string[] = [],
): Promise<string> {
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "tools/pack.ts",
      `--version=${version}`,
      `--out=${outDir}`,
      ...extraArgs,
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

  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  return path.join(outDir, `openpcb-core-library-${version}.opclib`);
}

/**
 * A full pack bakes every STEP model to GLB, so these budgets scale with the
 * size of `3d/`, not with the assertions below. They were set when the tree had
 * ~36 models; at 139 a CI runner needs well over the old 120s and the suite had
 * been failing as a timeout (surfacing as an Emscripten "null reference
 * (invoker...)" abort when Bun tore the in-flight pack down). Locally a full
 * pack is ~37s; the runner is several times slower, so budget generously — a
 * real regression fails on assertions, not on the clock.
 */
const PACK_TEST_TIMEOUT_MS = 600_000;

// Module-level: this single pack is shared by the tests that only read it, so
// its cost lands on whichever test awaits first.
const sharedArtifactPath = runPack("0.0.0-test", makeTempDir());

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CoreLibrary pack shared compatibility", () => {
  test("CLI output validates through shared readOpclibFromPath", async () => {
    const pkg = await readOpclibFromPath(await sharedArtifactPath);

    expect(pkg.manifest.schemaVersion).toBe("1.0.0");
    expect(pkg.manifest.library.id).toBe("openpcb.core");
    expect(pkg.manifest.library.version).toBe("0.0.0-test");
    expect(pkg.manifest.symbols.length).toBeGreaterThan(0);
    expect(pkg.manifest.footprints.length).toBeGreaterThan(0);
    expect(pkg.manifest.components.length).toBeGreaterThan(0);
  }, PACK_TEST_TIMEOUT_MS);

  test("packed referenced 3D models include renderable GLB assets", async () => {
    const pkg = await readOpclibFromPath(await sharedArtifactPath);
    const modelsById = new Map(pkg.manifest.models3d.map((model) => [model.id, model]));

    let referencedModels = 0;
    for (const footprint of pkg.manifest.footprints) {
      for (const modelId of footprint.models3d ?? []) {
        referencedModels += 1;
        const model = modelsById.get(modelId);
        expect(model, `missing model ${modelId}`).toBeDefined();
        expect(model!.formats.glb, `missing GLB for ${modelId}`).toBeDefined();
        expect(model!.formats.step, `missing STEP for ${modelId}`).toBeDefined();
        expect(pkg.assets.has(model!.formats.glb!.path.toLowerCase())).toBe(true);
      }
    }

    expect(referencedModels).toBeGreaterThan(0);
  }, PACK_TEST_TIMEOUT_MS);

  // The core pack ships GLB only — the app renders GLB, and STEP was over half
  // the payload. STEP is still read as the GLB source; --no-step only drops it
  // from the archive and emits it as a companion zip.
  test("--no-step yields a GLB-complete package with no STEP", async () => {
    const dir = makeTempDir();
    const artifactPath = await runPack("0.0.0-nostep", dir, ["--no-step"]);
    const pkg = await readOpclibFromPath(artifactPath);

    let referencedModels = 0;
    const modelsById = new Map(
      pkg.manifest.models3d.map((model) => [model.id, model]),
    );
    for (const footprint of pkg.manifest.footprints) {
      for (const modelId of footprint.models3d ?? []) {
        referencedModels += 1;
        const model = modelsById.get(modelId);
        expect(model, `missing model ${modelId}`).toBeDefined();
        // Still fully renderable...
        expect(model!.formats.glb, `missing GLB for ${modelId}`).toBeDefined();
        expect(
          pkg.assets.has(model!.formats.glb!.path.toLowerCase()),
        ).toBe(true);
        // ...but carries no STEP.
        expect(model!.formats.step, `unexpected STEP for ${modelId}`).toBeUndefined();
      }
    }
    expect(referencedModels).toBeGreaterThan(0);

    for (const assetPath of pkg.assets.keys()) {
      expect(assetPath.endsWith(".step")).toBe(false);
    }

    // Companion archive carries the STEP models plus their digests.
    const companion = path.join(dir, "openpcb-core-library-0.0.0-nostep-step.zip");
    const entries = unzipSync(readFileSync(companion));
    const stepEntries = Object.keys(entries).filter((k) => k.endsWith(".step"));
    expect(stepEntries.length).toBe(referencedModels);
    expect(entries["SHA256SUMS"]).toBeInstanceOf(Uint8Array);
  }, PACK_TEST_TIMEOUT_MS);

  test("shared reader rejects a tampered package asset", async () => {
    const dir = makeTempDir();
    const artifactPath = await sharedArtifactPath;
    const pkg = await readOpclibFromPath(artifactPath);
    const symbolPath = pkg.manifest.symbols[0]?.path;
    expect(symbolPath).toBeString();

    const entries = unzipSync(readFileSync(artifactPath));
    const tamperedBytes = entries[symbolPath as string];
    expect(tamperedBytes).toBeInstanceOf(Uint8Array);
    if (!tamperedBytes) throw new Error(`missing packed symbol ${symbolPath}`);
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff;

    const tamperedPath = path.join(dir, "tampered.opclib");
    writeFileSync(tamperedPath, zipSync(entries, { level: 6 }));

    await expect(readOpclibFromPath(tamperedPath)).rejects.toThrow(
      OpclibFormatError,
    );
  }, PACK_TEST_TIMEOUT_MS);
});
