import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  checkFootprintDrc,
  DRC_LIMITS,
  summarizeDrc,
  type DrcFootprint,
  type DrcPad,
} from "../tools/gates/footprint-drc";
import type { PreviewGraphic } from "../tools/gates/geometry";
import type { GateFinding, GateSeverity } from "../tools/gates/types";

const repoRoot = path.resolve(import.meta.dir, "..");

// --- fixture builders ---------------------------------------------------------

function fpOf(
  pads: DrcPad[],
  graphics: PreviewGraphic[] = [],
  id = "openpcb.core.footprint.test.fixture",
): DrcFootprint {
  return { id, normalized: { preview: { pads, graphics } } };
}

/** SMD land: front copper only, no drill. */
function smd(
  number: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<DrcPad> = {},
): DrcPad {
  return {
    id: `${number}:smd`,
    number,
    shape: "roundrect",
    centerMm: { x, y },
    widthMm: w,
    heightMm: h,
    rotationDeg: 0,
    layer: "F.Cu",
    layers: ["F.Cu", "F.Mask", "F.Paste"],
    ...extra,
  };
}

/** Plated through-hole: `*.Cu` on both sides, round drill unless overridden. */
function tht(
  number: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<DrcPad> = {},
): DrcPad {
  return {
    id: `${number}:tht`,
    number,
    shape: "circle",
    centerMm: { x, y },
    widthMm: w,
    heightMm: h,
    rotationDeg: 0,
    drillDiameterMm: 0.8,
    layer: "*.Cu",
    layers: ["*.Cu", "*.Mask"],
    ...extra,
  };
}

function courtyard(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PreviewGraphic {
  return {
    kind: "rect",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    strokeWidthMm: 0.05,
    layer: "F.CrtYd",
  };
}

function silk(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): PreviewGraphic {
  return {
    kind: "line",
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    strokeWidthMm: 0.12,
    layer: "F.SilkS",
  };
}

function of(findings: GateFinding[], severity: GateSeverity): GateFinding[] {
  return findings.filter((f) => f.severity === severity);
}

function text(findings: GateFinding[]): string {
  return findings.map((f) => `${f.severity}:${f.message}`).join(" | ");
}

// --- rule 1 + 2: drill --------------------------------------------------------

describe("G10 drill presence", () => {
  test("a through-hole pad with no drill fails", () => {
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1.5, 1.5, { drillDiameterMm: null })]),
    );
    expect(text(of(findings, "fail"))).toContain(
      "through-hole pad 1 has no drill",
    );
  });

  test("a through-hole pad with only a slot drill passes", () => {
    const findings = checkFootprintDrc(
      fpOf([
        tht("1", 0, 0, 2, 3.5, {
          drillDiameterMm: null,
          drillSlotMm: { widthMm: 1, heightMm: 3 },
        }),
      ]),
    );
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("an SMD pad with no drill is not a through-hole pad", () => {
    const findings = checkFootprintDrc(fpOf([smd("1", 0, 0, 1, 1)]));
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("a drill under the fab minimum warns", () => {
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1.5, 1.5, { drillDiameterMm: 0.2 })]),
    );
    expect(text(of(findings, "note"))).toContain("drill 0.200mm is below");
  });

  test("the smallest slot dimension is the one measured", () => {
    const findings = checkFootprintDrc(
      fpOf([
        tht("1", 0, 0, 3, 3, {
          drillDiameterMm: null,
          drillSlotMm: { widthMm: 0.2, heightMm: 2 },
        }),
      ]),
    );
    expect(text(of(findings, "note"))).toContain("drill 0.200mm is below");
  });
});

// --- rule 3: annular ring -----------------------------------------------------

describe("G10 annular ring", () => {
  test("the TO-92 ring of 0.15mm clears the 0.13mm floor", () => {
    // Real geometry from footprints/package/to-92-inline: 1.05mm pad, 0.75mm drill.
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1.05, 1.5, { drillDiameterMm: 0.75 })]),
    );
    expect(of(findings, "note")).toHaveLength(0);
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("a ring under the minimum warns", () => {
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1.0, 1.5, { drillDiameterMm: 0.8 })]),
    );
    expect(text(of(findings, "warn"))).toContain("annular ring 0.100mm");
  });

  test("a drill wider than a numbered pad fails", () => {
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 0.8, 1.5, { drillDiameterMm: 0.9 })]),
    );
    expect(text(of(findings, "fail"))).toContain("annular ring -0.050mm");
  });

  test("an unnumbered NPTH mounting hole is exempt", () => {
    // MountingHole_4.3mm: land == hole, so there is no ring to check.
    const findings = checkFootprintDrc(
      fpOf([tht("", 0, 0, 4.3, 4.3, { drillDiameterMm: 4.3 })]),
    );
    expect(findings).toHaveLength(0);
  });

  test("slot rings measure each axis independently", () => {
    const findings = checkFootprintDrc(
      fpOf([
        tht("1", 0, 0, 1.0, 3.0, {
          drillDiameterMm: null,
          drillSlotMm: { widthMm: 0.9, heightMm: 2.0 },
        }),
      ]),
    );
    // min((1.0-0.9)/2, (3.0-2.0)/2) = 0.05
    expect(text(of(findings, "warn"))).toContain("annular ring 0.050mm");
  });

  test("a 90-degree pad swaps the slot axes", () => {
    const rotated = checkFootprintDrc(
      fpOf([
        tht("1", 0, 0, 3.0, 1.0, {
          rotationDeg: 90,
          drillDiameterMm: null,
          drillSlotMm: { widthMm: 0.9, heightMm: 2.0 },
        }),
      ]),
    );
    expect(text(of(rotated, "warn"))).toContain("annular ring 0.050mm");
  });
});

// --- rule 4: copper-to-copper gap ---------------------------------------------

describe("G10 copper gap", () => {
  test("a 0.4mm-pitch QFN row clears the minimum", () => {
    const pads = [
      smd("1", -1, -0.6, 0.75, 0.2),
      smd("2", -1, -0.2, 0.75, 0.2),
      smd("3", -1, 0.2, 0.75, 0.2),
      smd("4", -1, 0.6, 0.75, 0.2),
    ];
    const findings = checkFootprintDrc(fpOf(pads, [courtyard(-2, -2, 2, 2)]));
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("pads closer than the minimum fail", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", -0.55, 0, 1, 1), smd("2", 0.55, 0, 1, 1)]),
    );
    // 1.1mm centres, 1mm wide pads -> 0.1mm gap.
    expect(text(of(findings, "fail"))).toContain("copper gap 0.100mm");
  });

  test("overlapping pads on different nets fail", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", 0, 0, 1, 1), smd("2", 0.4, 0, 1, 1)]),
    );
    expect(text(of(findings, "fail"))).toContain("overlap by 0.600mm");
  });

  test("pads sharing a number are one net and are not compared", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", 0, 0, 1, 1), smd("1", 0.4, 0, 1, 1)]),
    );
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("front and back pads never short through the board", () => {
    const back = smd("2", 0.4, 0, 1, 1, {
      layer: "B.Cu",
      layers: ["B.Cu", "B.Mask"],
    });
    const findings = checkFootprintDrc(fpOf([smd("1", 0, 0, 1, 1), back]));
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("a *.Cu pad shares copper with both sides", () => {
    const back = smd("2", 0.4, 0, 1, 1, {
      layer: "B.Cu",
      layers: ["B.Cu", "B.Mask"],
    });
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1, 1, { drillDiameterMm: 0.4 }), back]),
    );
    expect(text(of(findings, "fail"))).toContain("overlap");
  });

  test("paste-only sub-pads carry no copper and are ignored", () => {
    const paste: DrcPad = {
      id: "p:0",
      number: "",
      shape: "rect",
      centerMm: { x: 0.4, y: 0 },
      widthMm: 1,
      heightMm: 1,
      rotationDeg: 0,
      layer: "F.Paste",
      layers: ["F.Paste"],
      role: "paste",
    };
    const findings = checkFootprintDrc(fpOf([smd("1", 0, 0, 1, 1), paste]));
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("an exposed pad with same-numbered sub-pads stays clear of the pins", () => {
    const pads = [
      smd("1", -1, -0.6, 0.75, 0.2),
      smd("2", -1, -0.2, 0.75, 0.2),
      smd("3", -1, 0.2, 0.75, 0.2),
      smd("4", -1, 0.6, 0.75, 0.2),
      smd("17", 0, 0, 0.9, 0.9, { shape: "rect" }),
      smd("17", -0.2, -0.2, 0.3, 0.3, { shape: "rect" }),
      smd("17", 0.2, -0.2, 0.3, 0.3, { shape: "rect" }),
      smd("17", -0.2, 0.2, 0.3, 0.3, { shape: "rect" }),
      smd("17", 0.2, 0.2, 0.3, 0.3, { shape: "rect" }),
    ];
    const findings = checkFootprintDrc(fpOf(pads, [courtyard(-2, -2, 2, 2)]));
    expect(of(findings, "fail")).toHaveLength(0);
    expect(text(of(findings, "note"))).toContain('"17" x5');
  });
});

// --- rule 5: courtyard --------------------------------------------------------

describe("G10 courtyard coverage", () => {
  test("a courtyard enclosing every pad passes", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", -1, 0, 1, 1), smd("2", 1, 0, 1, 1)], [
        courtyard(-2, -1, 2, 1),
      ]),
    );
    expect(of(findings, "fail")).toHaveLength(0);
  });

  test("a courtyard that misses a pad fails with the overshoot", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", -1, 0, 1, 1), smd("2", 1, 0, 1, 1)], [
        courtyard(-2, -1, 1.2, 1),
      ]),
    );
    expect(text(of(findings, "fail"))).toContain(
      "courtyard does not enclose copper pad 2 (+0.300mm)",
    );
  });

  test("a footprint with no courtyard emits nothing here (G3 owns it)", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", -1, 0, 1, 1), smd("2", 1, 0, 1, 1)]),
    );
    expect(of(findings, "fail")).toHaveLength(0);
  });
});

// --- rule 6: silkscreen -------------------------------------------------------

describe("G10 silkscreen clearance", () => {
  test("silk outside the clearance band passes", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", 0, 0, 1, 1)], [courtyard(-2, -2, 2, 2), silk(-2, 0.9, 2, 0.9)]),
    );
    expect(of(findings, "note")).toHaveLength(0);
  });

  test("silk crossing a pad warns and names it", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", 0, 0, 1, 1)], [courtyard(-2, -2, 2, 2), silk(-2, 0, 2, 0)]),
    );
    expect(text(of(findings, "note"))).toContain(
      "silkscreen sits within 0.15mm of pad 1",
    );
  });

  test("back silk does not report front pads", () => {
    const back: PreviewGraphic = { ...silk(-2, 0, 2, 0), layer: "B.SilkS" };
    const findings = checkFootprintDrc(
      fpOf([smd("1", 0, 0, 1, 1)], [courtyard(-2, -2, 2, 2), back]),
    );
    expect(of(findings, "note")).toHaveLength(0);
  });

  test("a silk arc curving around the pads is not a hit", () => {
    // TO-92: the body arc sweeps outside the pad row. An AABB stand-in for the
    // arc would report a false hit on all three pads.
    const arc: PreviewGraphic = {
      kind: "arc3",
      start: { x: -0.568478, y: 1.838478 },
      mid: { x: -1.132087, y: -0.994977 },
      end: { x: 1.27, y: -2.6 },
      strokeWidthMm: 0.12,
      layer: "F.SilkS",
    };
    const pads = [
      tht("1", 0, 0, 1.05, 1.5, { drillDiameterMm: 0.75 }),
      tht("2", 1.27, 0, 1.05, 1.5, { drillDiameterMm: 0.75 }),
      tht("3", 2.54, 0, 1.05, 1.5, { drillDiameterMm: 0.75 }),
    ];
    const findings = checkFootprintDrc(fpOf(pads, [arc]));
    expect(text(of(findings, "warn"))).not.toContain("silkscreen");
  });
});

// --- rule 7: pin-1 marker -----------------------------------------------------

describe("G10 pin-1 marker", () => {
  const row = (shape1: string): DrcPad[] => [
    tht("1", 0, 0, 1.5, 1.5, { shape: shape1 }),
    tht("2", 2.54, 0, 1.5, 1.5),
    tht("3", 5.08, 0, 1.5, 1.5),
  ];
  const far = [courtyard(-1, -1, 6.1, 1), silk(-1, -6, 6, -6)];

  test("a two-pad footprint is skipped", () => {
    const findings = checkFootprintDrc(
      fpOf([tht("1", 0, 0, 1.5, 1.5), tht("2", 2.54, 0, 1.5, 1.5)], far),
    );
    expect(of(findings, "warn")).toHaveLength(0);
  });

  test("a distinct pad-1 shape counts as the marker", () => {
    const findings = checkFootprintDrc(fpOf(row("rect"), far));
    expect(text(of(findings, "warn"))).not.toContain("pin-1");
  });

  test("uniform pads with no nearby graphic warn", () => {
    const findings = checkFootprintDrc(fpOf(row("circle"), far));
    expect(text(of(findings, "warn"))).toContain("no pin-1 indicator");
  });

  test("a silk dot beside pad 1 counts as the marker", () => {
    const dot: PreviewGraphic = {
      kind: "circle",
      center: { x: -1.4, y: -1.4 },
      radiusMm: 0.15,
      strokeWidthMm: 0.12,
      layer: "F.SilkS",
    };
    const findings = checkFootprintDrc(fpOf(row("circle"), [...far, dot]));
    expect(text(of(findings, "warn"))).not.toContain("pin-1");
  });

  test("a footprint with no pad numbered 1 is skipped", () => {
    const pads = [
      tht("A", 0, 0, 1.5, 1.5),
      tht("B", 2.54, 0, 1.5, 1.5),
      tht("C", 5.08, 0, 1.5, 1.5),
    ];
    const findings = checkFootprintDrc(fpOf(pads, far));
    expect(text(of(findings, "warn"))).not.toContain("pin-1");
  });
});

// --- rule 8 (G11): duplicate numbers ------------------------------------------

describe("G11 duplicate pad numbers", () => {
  test("distinct numbers produce no note", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("1", -1, 0, 1, 1), smd("2", 1, 0, 1, 1)]),
    );
    expect(of(findings, "note")).toHaveLength(0);
  });

  test("shared numbers are a note, never a fail", () => {
    const findings = checkFootprintDrc(
      fpOf([smd("9", -1, 0, 1, 1), smd("9", 1, 0, 1, 1)]),
    );
    expect(of(findings, "fail")).toHaveLength(0);
    const notes = of(findings, "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.gate).toBe("G11");
    expect(notes[0]?.message).toContain('"9" x2');
  });

  test("unnumbered pads are not grouped together", () => {
    const findings = checkFootprintDrc(
      fpOf([
        tht("", -3, 0, 3, 3, { drillDiameterMm: 3 }),
        tht("", 3, 0, 3, 3, { drillDiameterMm: 3 }),
      ]),
    );
    expect(of(findings, "note")).toHaveLength(0);
  });
});

// --- limits -------------------------------------------------------------------

describe("DRC_LIMITS", () => {
  test("are the JLCPCB 2-layer minima the rules quote", () => {
    expect(DRC_LIMITS).toEqual({
      minDrillMm: 0.3,
      minAnnularMm: 0.13,
      minCopperGapMm: 0.127,
      silkClearanceMm: 0.15,
      pin1MarkerRadiusMm: 1.0,
    });
  });
});

// --- real tree ----------------------------------------------------------------

/**
 * Footprints whose G10 `fail` findings are accepted for now, with the measured
 * value. Everything here is a real finding, not a tuned-away one — the gate is
 * correct and the data (or the rule's reach) is what needs a decision.
 *
 * `usb-c-hro-type-c-31-m-12` — 4 pairs of pads sit exactly on top of each other
 * on F.Cu with different numbers: A1/B12, A4/B9, A9/B4, A12/B1, each a 0.600mm
 * overlap of a 0.6 x 1.45mm land. This is upstream KiCad's encoding for the
 * USB-C receptacle: the connector bridges those contacts internally (A1/B12 =
 * GND, A4/B9 and A9/B4 = VBUS, A12/B1 = GND), so one physical land carries two
 * pad numbers. Geometrically indistinguishable from a genuine two-net short, so
 * rule 4 cannot tell them apart without net information it does not have.
 * Decision for the orchestrator: either exempt fully coincident pads in rule 4,
 * or merge these into single pads at import.
 */
const KNOWN_DRC_FAILS = new Set<string>([
  // Empty since the coincident-pad exemption (USB-C A1/B12 etc. share one land).
]);

function footprintFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...footprintFiles(p));
    else if (p.endsWith(".fp.json")) out.push(p);
  }
  return out.sort();
}

function loadFootprints(): DrcFootprint[] {
  return footprintFiles(path.join(repoRoot, "footprints")).map(
    (p) => JSON.parse(readFileSync(p, "utf8")) as DrcFootprint,
  );
}

describe("checkFootprintDrc — real library", () => {
  test("no unexpected manufacturability failures", () => {
    const unexpected: string[] = [];
    for (const fp of loadFootprints()) {
      if (KNOWN_DRC_FAILS.has(fp.id)) continue;
      for (const f of of(checkFootprintDrc(fp), "fail")) {
        unexpected.push(`${fp.id}: ${f.message}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  test("every allowlisted footprint still fails (retire the entry otherwise)", () => {
    const byId = new Map(loadFootprints().map((fp) => [fp.id, fp]));
    for (const id of KNOWN_DRC_FAILS) {
      const fp = byId.get(id);
      expect(fp).toBeDefined();
      expect(of(checkFootprintDrc(fp as DrcFootprint), "fail").length).toBeGreaterThan(0);
    }
  });

  test("library-wide DRC extremes", () => {
    const summary = summarizeDrc(loadFootprints());
    expect(summary.footprints).toBeGreaterThan(100);
    expect(summary.copperPads).toBeGreaterThan(1000);
    console.log(
      [
        `footprints        ${summary.footprints} (${summary.copperPads} copper pads)`,
        `min annular ring  ${summary.minAnnular?.valueMm.toFixed(3)}mm  ${summary.minAnnular?.footprintId} pad ${summary.minAnnular?.padLabel}`,
        `min drill         ${summary.minDrill?.valueMm.toFixed(3)}mm  ${summary.minDrill?.footprintId} pad ${summary.minDrill?.padLabel}`,
        `min copper gap    ${summary.minGap?.valueMm.toFixed(3)}mm  ${summary.minGap?.footprintId} pads ${summary.minGap?.padLabel}`,
      ].join("\n"),
    );
    // The plated-hole floor is TO-92 at 0.15mm; NPTH holes are excluded.
    expect(summary.minAnnular?.valueMm).toBeGreaterThan(0);
  });
});
