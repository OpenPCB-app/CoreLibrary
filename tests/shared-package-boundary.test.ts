import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function readPackageJson(): {
  workspaces?: string[];
  dependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as {
    workspaces?: string[];
    dependencies?: Record<string, string>;
  };
}

describe("shared package boundary", () => {
  test("duplicated local parser/import packages are absent", () => {
    expect(existsSync(path.join(repoRoot, "packages", "kicad-parsers"))).toBe(
      false,
    );
    expect(existsSync(path.join(repoRoot, "packages", "core-import"))).toBe(
      false,
    );
  });

  test("root package consumes tagged shared packages directly", () => {
    const pkg = readPackageJson();

    expect(pkg.workspaces ?? []).not.toContain("packages/*");
    expect(pkg.dependencies?.["@openpcb/kicad-parsers"]).toBe(
      "github:OpenPCB-app/shared#kicad-parsers-v0.1.3",
    );
    expect(pkg.dependencies?.["@openpcb/kicad-import"]).toBe(
      "github:OpenPCB-app/shared#kicad-import-v0.1.2",
    );
    expect(pkg.dependencies?.["@openpcb/rendering-core"]).toBe(
      "github:OpenPCB-app/shared#rendering-core-v0.1.3",
    );
    expect(pkg.dependencies?.["@openpcb/opclib-pack"]).toBe(
      "github:OpenPCB-app/shared#opclib-pack-v0.3.0",
    );
    expect(pkg.dependencies?.["@openpcb/step-to-glb"]).toBe(
      "github:OpenPCB-app/shared#step-to-glb-v0.1.4",
    );
  });
});
