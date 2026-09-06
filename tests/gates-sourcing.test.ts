import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkSourcing,
  type ManufacturerPartEntry,
  type SourcingInput,
} from "../tools/gates/sourcing";
import { REPO_ROOT, loadJson, walkFiles } from "../tools/lib";

const goodPart: ManufacturerPartEntry = { manufacturer: "onsemi", mpn: "2N7000" };

describe("checkSourcing — description / keywords apply to every component", () => {
  test("missing description warns even for a connector", () => {
    const findings = checkSourcing({ id: "openpcb.core.connector.x", category: "connector" });
    expect(findings.some((f) => f.severity === "warn" && f.message.includes("description"))).toBe(
      true,
    );
  });

  test("empty keywords array warns", () => {
    const findings = checkSourcing({
      id: "openpcb.core.connector.x",
      category: "connector",
      description: "A connector",
      keywords: [],
    });
    expect(findings.some((f) => f.message.includes("keywords"))).toBe(true);
  });

  test("description and keywords both present -> no findings for a generic/non-function part", () => {
    const findings = checkSourcing({
      id: "openpcb.core.connector.x",
      category: "connector",
      description: "A connector",
      keywords: ["header"],
    });
    expect(findings).toEqual([]);
  });
});

describe("checkSourcing — generic components skip manufacturerParts checks", () => {
  test("a known generic with no manufacturerParts is not warned for sourcing", () => {
    const findings = checkSourcing({
      id: "openpcb.core.diode.zener",
      category: "diode",
      description: "Generic zener",
      keywords: ["zener"],
    });
    expect(findings).toEqual([]);
  });

  test("a non-function category with malformed entries is not validated at the entry level", () => {
    const findings = checkSourcing({
      id: "openpcb.core.connector.x",
      category: "connector",
      description: "A connector",
      keywords: ["header"],
      manufacturerParts: [{ manufacturer: "", mpn: "" } as ManufacturerPartEntry],
    });
    expect(findings).toEqual([]);
  });
});

describe("checkSourcing — no manufacturerParts on a non-generic function part", () => {
  test("warns", () => {
    const findings = checkSourcing({
      id: "openpcb.core.transistor.some-npn",
      category: "transistor",
      description: "An NPN",
      keywords: ["npn"],
    });
    expect(
      findings.some((f) => f.severity === "warn" && f.message.includes("manufacturerParts")),
    ).toBe(true);
  });
});

function withParts(parts: ManufacturerPartEntry[]): SourcingInput {
  return {
    id: "openpcb.core.transistor.some-npn",
    category: "transistor",
    description: "An NPN",
    keywords: ["npn"],
    manufacturerParts: parts,
  };
}

describe("checkSourcing — entry field validation", () => {
  test("missing manufacturer fails", () => {
    const findings = checkSourcing(withParts([{ manufacturer: "", mpn: "X" }]));
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("manufacturer"))).toBe(
      true,
    );
  });

  test("missing mpn fails", () => {
    const findings = checkSourcing(withParts([{ manufacturer: "onsemi", mpn: "" }]));
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("mpn"))).toBe(true);
  });

  test("malformed lcsc fails", () => {
    const findings = checkSourcing(withParts([{ ...goodPart, lcsc: "12345" }]));
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("lcsc"))).toBe(true);
  });

  test("well-formed lcsc does not fail", () => {
    const findings = checkSourcing(withParts([{ ...goodPart, lcsc: "C12345", datasheet: "https://x" }]));
    expect(findings.some((f) => f.severity === "fail")).toBe(false);
  });

  test("invalid jlcpcbAssemblyType fails", () => {
    const findings = checkSourcing(
      withParts([{ ...goodPart, jlcpcbAssemblyType: "gold" as never }]),
    );
    expect(
      findings.some((f) => f.severity === "fail" && f.message.includes("jlcpcbAssemblyType")),
    ).toBe(true);
  });

  test("invalid role fails", () => {
    const findings = checkSourcing(withParts([{ ...goodPart, role: "secondary" as never }]));
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("role"))).toBe(true);
  });

  test("first entry with role alternate fails", () => {
    const findings = checkSourcing(withParts([{ ...goodPart, role: "alternate" }]));
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("alternate"))).toBe(
      true,
    );
  });

  test("a later entry with role primary fails", () => {
    const findings = checkSourcing(
      withParts([
        { ...goodPart, role: "primary", datasheet: "https://x" },
        { manufacturer: "Diodes Inc", mpn: "ALT1", role: "primary", datasheet: "https://y" },
      ]),
    );
    expect(
      findings.some(
        (f) => f.severity === "fail" && f.message.includes("[1]") && f.message.includes("primary"),
      ),
    ).toBe(true);
  });

  test("first entry as explicit primary and a second as alternate is fine", () => {
    const findings = checkSourcing(
      withParts([
        { ...goodPart, role: "primary", datasheet: "https://x" },
        { manufacturer: "Diodes Inc", mpn: "ALT1", role: "alternate", datasheet: "https://y" },
      ]),
    );
    expect(findings.some((f) => f.severity === "fail")).toBe(false);
  });

  test("missing per-entry datasheet warns", () => {
    const findings = checkSourcing(withParts([goodPart]));
    expect(findings.some((f) => f.severity === "warn" && f.message.includes("datasheet"))).toBe(
      true,
    );
  });

  test("a fully well-formed single entry has no findings", () => {
    const findings = checkSourcing(withParts([{ ...goodPart, datasheet: "https://onsemi.com/x" }]));
    expect(findings).toEqual([]);
  });
});

describe("checkSourcing — real tree", () => {
  test("no fails anywhere in the current tree; log warn count", () => {
    const componentsRoot = path.join(REPO_ROOT, "components");
    let warnCount = 0;
    const fails: string[] = [];

    for (const file of walkFiles(componentsRoot, ".component.json")) {
      const data = loadJson<SourcingInput>(file);
      const findings = checkSourcing(data);
      for (const f of findings) {
        if (f.severity === "fail") fails.push(`${file}: ${f.message}`);
        else if (f.severity === "warn") warnCount++;
      }
    }

    expect(fails).toEqual([]);
    console.log(`[G7 real-tree] warn count=${warnCount}`);
  });
});
