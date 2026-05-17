import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../repo/paths";
import { ok, problem, type Handler } from "../http";

function runBun(
  scriptRel: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bun", [scriptRel], { cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export const runValidate: Handler = async () => {
  const result = await runBun("tools/validate.ts");
  return ok(result, { status: result.code === 0 ? 200 : 422 });
};

export const runPack: Handler = async () => {
  const result = await runBun("tools/pack.ts");
  if (result.code !== 0) {
    return ok(result, { status: 500 });
  }
  // pack.ts writes to dist/ — find newest .opclib
  const dist = path.join(REPO_ROOT, "dist");
  if (!existsSync(dist)) {
    return problem(
      500,
      "pack-failed",
      `dist/ missing; output:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const files = readdirSync(dist)
    .filter((f) => f.endsWith(".opclib"))
    .map((f) => ({ f, mtime: Bun.file(path.join(dist, f)).lastModified }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files[0]) {
    return problem(500, "pack-empty", "no .opclib in dist/");
  }
  return ok({ ...result, artifact: files[0].f });
};

export const downloadOpclib: Handler = (_req, params) => {
  const name = params.name!;
  const abs = path.join(REPO_ROOT, "dist", name);
  if (!existsSync(abs)) return problem(404, "not-found", name);
  return new Response(Bun.file(abs), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
};

export const gitStatus: Handler = async () => {
  const proc = spawn("git", ["status", "--porcelain"], { cwd: REPO_ROOT });
  let out = "";
  await new Promise<void>((resolve) => {
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", () => resolve());
  });
  const lines = out.split("\n").filter((l) => l.length > 0);
  return ok({
    dirty: lines.length,
    files: lines.slice(0, 200).map((l) => ({
      status: l.slice(0, 2),
      path: l.slice(3),
    })),
  });
};

export const repoInfo: Handler = () => {
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { name: string; version: string };
  return ok({
    name: pkg.name,
    version: pkg.version,
    repoRoot: REPO_ROOT,
  });
};
