#!/usr/bin/env bun
/**
 * check-datasheet-links — gate for curated `datasheet` URLs.
 *
 * The default check is STRUCTURAL and does no network I/O:
 *   - https (never http — several vendors 301 http -> https and drop the path)
 *   - resolves to a direct PDF, not a landing page, viewer or download gate
 *   - is not hosted on a dead or mirror/aggregator host (see `BANNED_HOSTS`)
 *
 * Reachability is deliberately NOT the default gate. Manufacturer WAFs block
 * datacenter egress: st.com and analog.com time out entirely from CI/CLI, and
 * onsemi, microchip, tdk and irf answer 403 to every request that is not a real
 * browser. Those URLs are correct and current — they simply cannot be probed.
 * Hard-failing on them would make the build red for good data, so the network
 * probe is opt-in (`--network`) and only *unblocked* hosts can fail it.
 *
 * `datasheetSource` is upstream KiCad provenance, often a vendor landing page.
 * validate.ts already checks it is a well-formed URL; it is not gated here.
 *
 * Flags:
 *   --only <substring>  restrict to component ids containing the substring
 *   --network           additionally probe reachability (concurrent, bounded)
 *   --strict-network    with --network, make hard 404/410 on a non-blocked host fatal
 */
import path from "node:path";
import { REPO_ROOT, loadJson, relPath, walkFiles } from "./lib";

interface ComponentLinks {
  id: string;
  datasheet?: string | null;
  datasheetSource?: string;
}

/**
 * Hosts that must never carry a curated `datasheet`. Two kinds:
 * retired vendor hosts whose PDFs are gone (their content moved), and
 * mirror/aggregator sites that are not the manufacturer and rot or paywall.
 */
const BANNED_HOSTS = new Map<string, string>([
  ["datasheets.maximintegrated.com", "retired — Maxim content moved to analog.com"],
  ["www.intersil.com", "retired — Intersil content moved to renesas.com"],
  ["www.irf.com", "retired — International Rectifier content moved to infineon.com"],
  ["wizwiki.net", "dead — WIZnet wiki retired, use docs.wiznet.io"],
  ["www.xlsemi.net", "dead host"],
  ["www.icbase.com", "aggregator mirror"],
  ["www.datasheet5.com", "aggregator mirror"],
  ["www.alldatasheet.com", "aggregator mirror"],
  ["pdf1.alldatasheet.com", "aggregator mirror"],
  ["www.datasheetcatalog.com", "aggregator mirror"],
  ["datasheet.lcsc.com", "distributor mirror — not the manufacturer"],
  ["www.lcsc.com", "distributor mirror — not the manufacturer"],
  ["mm.digikey.com", "distributor mirror — not the manufacturer"],
  ["www.mouser.com", "distributor mirror — not the manufacturer"],
  ["akizukidenshi.com", "reseller mirror"],
]);

/**
 * Hosts known to reject automated probes (WAF / bot protection). A non-200 from
 * one of these says nothing about the URL, so `--network` reports them as
 * `blocked` and never fails on them.
 */
const WAF_HOSTS = new Set([
  "www.st.com",
  "www.analog.com",
  "www.onsemi.com",
  "ww1.microchip.com",
  "www.microchip.com",
  "product.tdk.com",
  "www.infineon.com",
  "www.nxp.com",
  "www.hirose.com",
  "www.kingbright.com",
  "www.phoenixcontact.com",
  "www.littelfuse.com",
]);

/**
 * Query-string document endpoints that are legitimately a direct PDF even
 * though the path does not end in `.pdf`. Anything else with a query string is
 * treated as a download gate.
 */
const PDF_ENDPOINTS = [
  "www.centralsemi.com/get_document.php",
  "www.allegromicro.com/",
  "www.phoenixcontact.com/product/pdf/api/",
  "www.littelfuse.com/assetdocs/",
];

const argv = process.argv.slice(2);
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] : undefined;
const doNetwork = argv.includes("--network");
const strictNetwork = argv.includes("--strict-network");

const componentsRoot = path.join(REPO_ROOT, "components");
const targets: Array<{ id: string; file: string; url: string }> = [];
for (const file of walkFiles(componentsRoot, ".component.json")) {
  const data = loadJson<ComponentLinks>(file);
  if (only && !data.id.includes(only)) continue;
  if (typeof data.datasheet === "string" && data.datasheet.length > 0)
    targets.push({ id: data.id, file, url: data.datasheet });
}

const failures: string[] = [];
function fail(target: { id: string; file: string }, message: string): void {
  failures.push(`${relPath(target.file)}: ${target.id} ${message}`);
}

// ---------------------------------------------------------------- structural

function looksLikeDirectPdf(url: URL): boolean {
  if (url.pathname.toLowerCase().endsWith(".pdf")) return true;
  const withoutScheme = `${url.host}${url.pathname}`;
  return PDF_ENDPOINTS.some((prefix) => withoutScheme.startsWith(prefix));
}

for (const target of targets) {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    fail(target, `datasheet is not a valid URL: ${target.url}`);
    continue;
  }
  if (url.protocol !== "https:") {
    fail(target, `datasheet must be https (got ${url.protocol}): ${target.url}`);
    continue;
  }
  const banned = BANNED_HOSTS.get(url.host);
  if (banned) {
    fail(target, `datasheet host ${url.host} is not allowed (${banned}): ${target.url}`);
    continue;
  }
  if (!looksLikeDirectPdf(url)) {
    fail(target, `datasheet must link a direct PDF, not a landing/download page: ${target.url}`);
  }
}

if (targets.length === 0) {
  console.log("[check-datasheet-links] no curated datasheet URLs to check");
  process.exit(0);
}
console.log(`[check-datasheet-links] structural: ${targets.length - failures.length}/${targets.length} OK`);

// ------------------------------------------------------------------- network

if (doNetwork && failures.length === 0) {
  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  type Verdict = "pdf" | "blocked" | "missing" | "not-pdf";

  // No timeout here means one slow vendor hangs the whole job forever.
  async function probe(url: string): Promise<{ verdict: Verdict; detail: string }> {
    const host = new URL(url).host;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": UA, accept: "application/pdf,*/*" },
      });
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (res.ok && type.includes("pdf")) return { verdict: "pdf", detail: "" };
      if (WAF_HOSTS.has(host)) return { verdict: "blocked", detail: `HTTP ${res.status}` };
      if (res.status === 404 || res.status === 410)
        return { verdict: "missing", detail: `HTTP ${res.status}` };
      return {
        verdict: "not-pdf",
        detail: `HTTP ${res.status} content-type ${type || "<none>"}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (WAF_HOSTS.has(host)) return { verdict: "blocked", detail: message };
      return { verdict: "not-pdf", detail: message };
    } finally {
      clearTimeout(timer);
    }
  }

  const counts: Record<Verdict, number> = { pdf: 0, blocked: 0, missing: 0, "not-pdf": 0 };
  const soft: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < targets.length) {
        const target = targets[next++]!;
        const { verdict, detail } = await probe(target.url);
        counts[verdict]++;
        if (verdict === "missing" && strictNetwork) {
          fail(target, `datasheet is gone (${detail}): ${target.url}`);
        } else if (verdict !== "pdf") {
          soft.push(`  ${verdict.padEnd(8)} ${target.id} — ${detail} ${target.url}`);
        }
      }
    }),
  );
  console.log(
    `[check-datasheet-links] network: ${counts.pdf} pdf · ${counts.blocked} blocked (WAF, not a failure) · ` +
      `${counts.missing} missing · ${counts["not-pdf"]} other`,
  );
  for (const line of soft) console.log(line);
}

if (failures.length > 0) {
  console.error(`[check-datasheet-links] ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("[check-datasheet-links] OK");
