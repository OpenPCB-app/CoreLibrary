#!/usr/bin/env bun
/**
 * check-datasheet-links — CI guard for link-only datasheets.
 *
 * Checks every curated `datasheet` URL across components/ resolves (HTTP 200) and is served
 * as a PDF. `datasheetSource` is upstream provenance (often a manufacturer landing page, not a
 * direct PDF) and is intentionally NOT PDF-enforced here — `validate.ts` already verifies it is
 * a well-formed URL. No-op when no component carries a curated `datasheet` (the pure-generic v1
 * passive set), so it is safe to run in CI before any function-parts land. Exits nonzero on any
 * broken or non-PDF link.
 *
 * Flags: --only <substring>   restrict to component ids containing the substring.
 */
import path from "node:path";
import { REPO_ROOT, loadJson, walkFiles } from "./lib";

interface ComponentLinks {
  id: string;
  datasheet?: string | null;
  datasheetSource?: string;
}

const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : undefined;

const componentsRoot = path.join(REPO_ROOT, "components");
const targets: Array<{ id: string; field: string; url: string }> = [];
for (const file of walkFiles(componentsRoot, ".component.json")) {
  const data = loadJson<ComponentLinks>(file);
  if (only && !data.id.includes(only)) continue;
  if (typeof data.datasheet === "string" && data.datasheet.length > 0)
    targets.push({ id: data.id, field: "datasheet", url: data.datasheet });
}

if (targets.length === 0) {
  console.log("[check-datasheet-links] no datasheet URLs to check");
  process.exit(0);
}

// Some hosts reject HEAD (403/405); fall back to a single-byte ranged GET.
async function probe(
  url: string,
): Promise<{ ok: boolean; status: number; type: string }> {
  const head = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (head.ok || (head.status !== 403 && head.status !== 405)) {
    return {
      ok: head.ok,
      status: head.status,
      type: head.headers.get("content-type") ?? "",
    };
  }
  const get = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { range: "bytes=0-0" },
  });
  return {
    ok: get.ok,
    status: get.status,
    type: get.headers.get("content-type") ?? "",
  };
}

const failures: string[] = [];
for (const target of targets) {
  try {
    const { ok, status, type } = await probe(target.url);
    if (!ok) {
      failures.push(
        `${target.id} ${target.field}: HTTP ${status} for ${target.url}`,
      );
    } else if (!type.toLowerCase().includes("pdf")) {
      failures.push(
        `${target.id} ${target.field}: not a PDF (content-type: ${type || "<none>"}) for ${target.url}`,
      );
    } else {
      console.log(`  OK ${target.id} ${target.field}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${target.id} ${target.field}: ${message} for ${target.url}`);
  }
}

if (failures.length > 0) {
  console.error(`[check-datasheet-links] ${failures.length} broken link(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`[check-datasheet-links] OK — ${targets.length} link(s) reachable`);
