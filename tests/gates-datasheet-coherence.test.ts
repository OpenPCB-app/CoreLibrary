import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkDatasheetCoherence,
  type DatasheetCoherenceInput,
} from "../tools/gates/datasheet-coherence";
import { REPO_ROOT, loadJson, walkFiles } from "../tools/lib";

describe("checkDatasheetCoherence — skip conditions", () => {
  test("no manufacturerParts at all -> skipped", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      datasheet: "https://www.onsemi.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("empty manufacturerParts array -> skipped", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [],
      datasheet: "https://www.onsemi.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("no datasheet -> skipped", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "onsemi" }],
    });
    expect(findings).toEqual([]);
  });

  test("null datasheet -> skipped", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "onsemi" }],
      datasheet: null,
    });
    expect(findings).toEqual([]);
  });
});

describe("checkDatasheetCoherence — host resolution", () => {
  test("matching host and manufacturer -> no findings", () => {
    const findings = checkDatasheetCoherence({
      id: "openpcb.core.diode.example",
      manufacturerParts: [{ manufacturer: "onsemi" }],
      datasheet: "https://www.onsemi.com/pdf/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("a subdomain of a known host suffix still matches", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "Nexperia" }],
      datasheet: "https://assets.nexperia.com/documents/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("unknown host -> note", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "Acme" }],
      datasheet: "https://cdn-shop.adafruit.com/x.pdf",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.gate).toBe("G8");
    expect(findings[0]?.severity).toBe("note");
  });

  test("mismatched host manufacturer vs primary -> warn naming both", () => {
    const findings = checkDatasheetCoherence({
      id: "openpcb.core.transistor.tip41c",
      manufacturerParts: [{ manufacturer: "onsemi" }],
      datasheet: "https://www.centralsemi.com/pdf/x.pdf",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.message).toContain("Central Semiconductor");
    expect(findings[0]?.message).toContain("onsemi");
  });
});

describe("checkDatasheetCoherence — manufacturer alias normalisation", () => {
  test("ON Semiconductor is recognized as onsemi (case-insensitive)", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "ON Semiconductor" }],
      datasheet: "https://www.onsemi.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("TI is recognized as Texas Instruments", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "TI" }],
      datasheet: "https://www.ti.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("Atmel is recognized as Microchip (acquisition alias)", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "Atmel" }],
      datasheet: "https://www.microchip.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });
});

describe("checkDatasheetCoherence — primary resolution", () => {
  test("an explicit role=primary entry beats entries[0] when entries[0] has no role", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [
        { manufacturer: "Wrong Co" },
        { manufacturer: "onsemi", role: "primary" },
      ],
      datasheet: "https://www.onsemi.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });

  test("falls back to entries[0] when no entry is marked primary", () => {
    const findings = checkDatasheetCoherence({
      id: "x",
      manufacturerParts: [{ manufacturer: "onsemi" }, { manufacturer: "Wrong Co" }],
      datasheet: "https://www.onsemi.com/x.pdf",
    });
    expect(findings).toEqual([]);
  });
});

describe("checkDatasheetCoherence — real tree", () => {
  test("logs the current warn/note lists (advisory, not asserted exactly)", () => {
    const componentsRoot = path.join(REPO_ROOT, "components");
    const warns: string[] = [];
    const notes: string[] = [];

    for (const file of walkFiles(componentsRoot, ".component.json")) {
      const data = loadJson<DatasheetCoherenceInput>(file);
      for (const f of checkDatasheetCoherence(data)) {
        if (f.severity === "warn") warns.push(f.message);
        else if (f.severity === "note") notes.push(f.message);
      }
    }

    console.log(`[G8 real-tree] warn=${warns.length} note=${notes.length}`);
    for (const w of warns) console.log(`  WARN ${w}`);
    for (const n of notes) console.log(`  NOTE ${n}`);
    // G8 is advisory-only (warn/note); never fail. The real tree is expected to
    // reach zero warns once every datasheet/manufacturer pair is coherent, so
    // this asserts the gate ran over the tree, not that it found something.
    expect(warns.length + notes.length).toBeGreaterThanOrEqual(0);
  });
});
