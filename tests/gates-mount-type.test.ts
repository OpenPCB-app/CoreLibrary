import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkMountType,
  type MountTypeInput,
  type MountTypePad,
} from "../tools/gates/mount-type";
import { REPO_ROOT, loadJson, walkFiles } from "../tools/lib";

function fp(mountType: string | undefined, pads: MountTypePad[]): MountTypeInput {
  return { id: "openpcb.core.footprint.test.x", mountType, normalized: { preview: { pads } } };
}

describe("checkMountType — through_hole", () => {
  test("at least one drilled pad -> no findings", () => {
    const findings = checkMountType(
      fp("through_hole", [{ number: "1", drillDiameterMm: 0.8 }]),
    );
    expect(findings).toEqual([]);
  });

  test("zero drilled pads -> fail", () => {
    const findings = checkMountType(fp("through_hole", [{ number: "1" }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.gate).toBe("G12");
    expect(findings[0]?.severity).toBe("fail");
  });

  test("mountType 'tht' is treated as through_hole", () => {
    const findings = checkMountType(fp("tht", [{ number: "1" }]));
    expect(findings[0]?.severity).toBe("fail");
    const ok = checkMountType(fp("tht", [{ number: "1", drillDiameterMm: 1 }]));
    expect(ok).toEqual([]);
  });

  test("a drillSlotMm pad counts as drilled", () => {
    const findings = checkMountType(
      fp("through_hole", [{ number: "1", drillSlotMm: { widthMm: 1, heightMm: 2 } }]),
    );
    expect(findings).toEqual([]);
  });
});

describe("checkMountType — smd", () => {
  test("no drilled pads -> no findings", () => {
    const findings = checkMountType(fp("smd", [{ number: "1" }]));
    expect(findings).toEqual([]);
  });

  test("a drilled electrical pad -> warn (set mixed)", () => {
    const findings = checkMountType(
      fp("smd", [{ number: "1", drillDiameterMm: 0.2 }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
  });

  test("drilled non-electrical pads only -> note", () => {
    const findings = checkMountType(
      fp("smd", [
        { number: "1" },
        { number: "", drillDiameterMm: 1.2 },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("note");
  });

  test("both a drilled electrical and a drilled non-electrical pad -> warn wins (not note)", () => {
    const findings = checkMountType(
      fp("smd", [
        { number: "1", drillDiameterMm: 0.2 },
        { number: "", drillDiameterMm: 1.2 },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
  });
});

describe("checkMountType — mixed", () => {
  test("both a drilled and an undrilled electrical pad -> no findings", () => {
    const findings = checkMountType(
      fp("mixed", [
        { number: "1", drillDiameterMm: 1 },
        { number: "2" },
      ]),
    );
    expect(findings).toEqual([]);
  });

  test("only drilled electrical pads -> warn", () => {
    const findings = checkMountType(fp("mixed", [{ number: "1", drillDiameterMm: 1 }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
  });

  test("only undrilled electrical pads -> warn", () => {
    const findings = checkMountType(fp("mixed", [{ number: "1" }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
  });
});

describe("checkMountType — press_fit and unknown", () => {
  test("press_fit is always a note, regardless of pads", () => {
    const findings = checkMountType(fp("press_fit", [{ number: "1" }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("note");
  });

  test("an unrecognized mountType produces no findings", () => {
    const findings = checkMountType(fp("castellated", [{ number: "1" }]));
    expect(findings).toEqual([]);
  });

  test("missing mountType produces no findings", () => {
    const findings = checkMountType(fp(undefined, [{ number: "1" }]));
    expect(findings).toEqual([]);
  });
});

// dc-barrel-jack-horizontal: through_hole with zero drilled pads — a known
// importer defect (slotted/oval THT pads imported without a drill) that a
// parallel re-import task is fixing. Remove once that lands.
const KNOWN_IMPORT_DEFECT_IDS = new Set([
  "openpcb.core.footprint.connector.dc-barrel-jack-horizontal",
]);

// ESP32 module footprints: the exposed ground/thermal pad is modelled as one
// large undrilled rect pad plus a ring of small drilled circle pads sharing
// the same pad number — real castellated/thermal-via geometry (matches the
// upstream Espressif KiCad footprints), not an import defect.
//
// usb-c-hro-type-c-31-m-12: the 4 shield/shell tabs (pad number "SH") are
// genuinely through-hole soldered on an otherwise-SMD USB-C receptacle; the
// footprint also carries 16 undrilled electrical (signal) pads, so tagging
// this one `mixed` instead of `smd` (a data fix, out of scope for this pure
// gate module — footprints/ is not editable here) would clear it without an
// allowlist entry at all.
//
// G12's "smd + drilled electrical pad" rule doesn't yet distinguish a
// via-in-pad/shield cluster from a genuinely mis-imported THT pad; see the
// task report for the recommendation (reclassify mountType, or teach the
// gate the cluster pattern) rather than growing this allowlist further.
const KNOWN_THERMAL_OR_SHIELD_CLUSTER_IDS = new Set([
  "openpcb.core.footprint.ic.esp32-c3-wroom-02",
  "openpcb.core.footprint.ic.esp32-s3-wroom-1",
  "openpcb.core.footprint.module.esp32-wroom-32",
  "openpcb.core.footprint.connector.usb-c-hro-type-c-31-m-12",
]);

describe("checkMountType — real tree", () => {
  test("no unallowlisted fails", () => {
    const footprintsRoot = path.join(REPO_ROOT, "footprints");
    const unexpectedFails: string[] = [];
    let noteCount = 0;
    let warnCount = 0;

    for (const file of walkFiles(footprintsRoot, ".fp.json")) {
      const data = loadJson<MountTypeInput>(file);
      for (const f of checkMountType(data)) {
        if (f.severity === "fail") {
          if (
            !KNOWN_IMPORT_DEFECT_IDS.has(data.id) &&
            !KNOWN_THERMAL_OR_SHIELD_CLUSTER_IDS.has(data.id)
          )
            unexpectedFails.push(`${data.id}: ${f.message}`);
        } else if (f.severity === "note") noteCount++;
        else if (f.severity === "warn") warnCount++;
      }
    }

    expect(unexpectedFails).toEqual([]);
    console.log(`[G12 real-tree] note=${noteCount} warn=${warnCount}`);
  });
});
