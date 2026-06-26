import { describe, expect, test } from "bun:test";
import {
  evaluateOrientation,
  normalizeMountType,
  orientationHintFromName,
  referenceBounds,
  worstSeverity,
  type ModelBounds,
} from "../tools/orientation-gate";

function bounds(
  min: [number, number, number],
  max: [number, number, number],
): ModelBounds {
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    center: {
      x: (min[0] + max[0]) / 2,
      y: (min[1] + max[1]) / 2,
      z: (min[2] + max[2]) / 2,
    },
  };
}

// Pad-bounds reference roughly matching an 0603/SMD courtyard centred at origin.
const SMD_REF = { minX: -0.9, minY: -0.5, maxX: 0.9, maxY: 0.5 };

describe("normalizeMountType", () => {
  test("maps KiCad through_hole to tht", () => {
    expect(normalizeMountType("through_hole")).toBe("tht");
    expect(normalizeMountType("smd")).toBe("smd");
    expect(normalizeMountType(undefined)).toBe("other");
  });
});

describe("orientationHintFromName", () => {
  test("reads vertical/horizontal from the name", () => {
    expect(orientationHintFromName("PinHeader_1x02_Vertical")).toBe("vertical");
    expect(orientationHintFromName("R_Axial_..._Horizontal")).toBe(
      "horizontal",
    );
    expect(orientationHintFromName("R_0603")).toBe("unknown");
  });
});

describe("evaluateOrientation — SMD", () => {
  test("a body resting on the board passes", () => {
    const findings = evaluateOrientation({
      mountType: "smd",
      bounds: bounds([-0.8, -0.4, 0], [0.8, 0.4, 1.1]), // LED, identity
      reference: SMD_REF,
    });
    expect(worstSeverity(findings)).toBeNull();
  });

  test("the baked rotationDeg.x=-90 bug (body sunk below board) is rejected", () => {
    const findings = evaluateOrientation({
      mountType: "smd",
      bounds: bounds([-0.8, 0, -0.4], [0.8, 1.1, 0.4]), // LED rotated -90° about X
      reference: SMD_REF,
    });
    expect(worstSeverity(findings)).toBe("error");
    expect(findings.some((f) => f.check === "on-board")).toBe(true);
  });

  test("an off-centre / mirror-needed model is rejected on XY centre", () => {
    const findings = evaluateOrientation({
      mountType: "smd",
      bounds: bounds([-0.8, -3.4, 0], [0.8, 0.6, 1.1]), // shifted -1.4mm in Y
      reference: SMD_REF,
    });
    expect(findings.some((f) => f.check === "xy-center")).toBe(true);
  });

  test("a grossly oversized model (e.g. wrong STEP unit) is flagged on coverage", () => {
    const findings = evaluateOrientation({
      mountType: "smd",
      bounds: bounds([-20, -10, 0], [20, 10, 28]), // ~22x the footprint extent
      reference: SMD_REF,
    });
    expect(findings.some((f) => f.check === "xy-coverage")).toBe(true);
  });

  test("a degenerate sub-0.05mm extent is rejected on scale", () => {
    const findings = evaluateOrientation({
      mountType: "smd",
      bounds: bounds([-0.01, -0.01, 0], [0.01, 0.01, 0.02]),
      reference: SMD_REF,
    });
    expect(findings.some((f) => f.check === "scale")).toBe(true);
  });
});

describe("evaluateOrientation — THT", () => {
  test("a vertical pin header (leads below board, tall body) passes", () => {
    const findings = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([-1.27, -1.27, -3], [1.27, 3.81, 8.54]), // mirror-corrected
      reference: { minX: -1.38, minY: -1.38, maxX: 1.38, maxY: 3.92 },
      orientationHint: "vertical",
    });
    expect(worstSeverity(findings)).toBeNull();
  });

  test("a tipped-over vertical THT (no body above board) is rejected", () => {
    const findings = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([-1.27, -3, -0.2], [1.27, 8.54, 0.2]), // body laid into +Y, flat in Z
      reference: { minX: -1.38, minY: -1.38, maxX: 1.38, maxY: 3.92 },
      orientationHint: "vertical",
    });
    expect(worstSeverity(findings)).toBe("error");
  });

  // TO-220 reference: pads in a row along X (centre y≈0), body+tab stand up in
  // +Z and sit behind the pad row in +Y, full leads reach ~9mm below the board.
  const TO220_REF = { minX: -3.5, minY: -1.0, maxX: 3.5, maxY: 1.0 };

  test("a vertical TO-220 (long leads, body behind the pad row) passes", () => {
    const findings = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([-5, -1, -9], [5, 9.5, 10]), // body up in +Z/+Y, leads -9mm
      reference: TO220_REF,
      orientationHint: "vertical",
    });
    // Allowed to warn (body-behind-pads, up-axis), but must not hard-fail.
    expect(findings.some((f) => f.severity === "error")).toBe(false);
  });

  test("the same TO-220 bounds WITHOUT a vertical hint hard-fails on lead budget", () => {
    const findings = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([-5, -1, -9], [5, 9.5, 10]),
      reference: TO220_REF,
      // no orientationHint → default 6mm budget
    });
    expect(
      findings.some((f) => f.check === "on-board" && f.severity === "error"),
    ).toBe(true);
  });

  test("a vertical THT body offset ONLY in Y is a warning, but an X drift still errors", () => {
    const behind = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([-3.5, 2, -3], [3.5, 6, 9]), // centred in X, +4mm in Y
      reference: TO220_REF,
      orientationHint: "vertical",
    });
    const xy = behind.find((f) => f.check === "xy-center");
    expect(xy?.severity).toBe("warning");

    const drifted = evaluateOrientation({
      mountType: "tht",
      bounds: bounds([1, 2, -3], [8, 6, 9]), // off in BOTH x and y
      reference: TO220_REF,
      orientationHint: "vertical",
    });
    expect(
      drifted.some((f) => f.check === "xy-center" && f.severity === "error"),
    ).toBe(true);
  });
});

describe("referenceBounds", () => {
  test("unions pad and silk geometry", () => {
    const ref = referenceBounds({
      pads: [{ centerMm: { x: 0, y: 0 }, widthMm: 1.7, heightMm: 1.7 }],
      graphics: [{ a: { x: -1.38, y: -1.38 }, b: { x: 1.38, y: 3.92 } }],
    });
    expect(ref).not.toBeNull();
    expect(ref?.maxY).toBeCloseTo(3.92, 5);
    expect(ref?.minX).toBeCloseTo(-1.38, 5);
  });
});
