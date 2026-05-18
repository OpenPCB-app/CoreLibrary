import { afterEach, describe, expect, test } from "bun:test";
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

async function runPack(version: string, outDir: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "tools/pack.ts",
      `--version=${version}`,
      `--out=${outDir}`,
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CoreLibrary pack shared compatibility", () => {
  test("CLI output validates through shared readOpclibFromPath", async () => {
    const artifactPath = await runPack("0.0.0-test", makeTempDir());

    const pkg = await readOpclibFromPath(artifactPath);

    expect(pkg.manifest.schemaVersion).toBe("1.0.0");
    expect(pkg.manifest.library.id).toBe("openpcb.core");
    expect(pkg.manifest.library.version).toBe("0.0.0-test");
    expect(pkg.manifest.symbols.length).toBeGreaterThan(0);
    expect(pkg.manifest.footprints.length).toBeGreaterThan(0);
    expect(pkg.manifest.components.length).toBeGreaterThan(0);
  });

  test("shared reader rejects a tampered package asset", async () => {
    const dir = makeTempDir();
    const artifactPath = await runPack("0.0.0-tamper", dir);
    const pkg = await readOpclibFromPath(artifactPath);
    const symbolPath = pkg.manifest.symbols[0]?.path;
    expect(symbolPath).toBeString();

    const entries = unzipSync(readFileSync(artifactPath));
    const tamperedBytes = entries[symbolPath as string];
    expect(tamperedBytes).toBeInstanceOf(Uint8Array);
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff;

    const tamperedPath = path.join(dir, "tampered.opclib");
    writeFileSync(tamperedPath, zipSync(entries, { level: 6 }));

    await expect(readOpclibFromPath(tamperedPath)).rejects.toThrow(
      OpclibFormatError,
    );
  });
});
