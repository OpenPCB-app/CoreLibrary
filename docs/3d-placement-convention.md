# 3D model placement convention

Authoritative rules for how a `.model.json` 3D model is oriented and placed onto
its footprint. Every placement tool (`pack`, `audit:3d`, the contact sheets, the
gate) and the OpenPCB renderer assume this frame. If a model renders wrong in the
3D view, it violates something here.

## Canonical frame

- **Z-up, millimetres, origin at the footprint origin.** The board top sits on
  the `z = 0` plane; component bodies rise into **+Z**. X/Y match the footprint's
  pad coordinates 1:1. This is the OpenPCB scene frame (Three.js' Y-up is
  repurposed as Z-up for PCB work).
- A correctly authored SMD model therefore has **`min.z ≈ 0`** (base on the
  board) and extends up to its body height in `max.z`. A through-hole model may
  have **`min.z < 0`** (leads protrude below the board).

## File layout

The canonical path policy is `3d/<category>/<footprint-or-model-slug>.step` with
a matching `.model.json` sidecar beside it. The STEP is source and is committed;
the runtime `.glb` is generated at pack time and is gitignored. A footprint whose
owning component is marked `no3d` has neither — see
[CONTRIBUTING.md](../CONTRIBUTING.md) for when that is legitimate.

## KiCad-derived STEP rule (the important one)

Per KiCad Library Convention [M2.2] and [F9.3], STEP models **must be authored
1:1:1 scale, zero offset, zero rotation** — aligned in CAD, Z-up, centred on the
footprint origin. So for a compliant KiCad STEP the sidecar transform is
**identity**:

```json
"offsetMm":   { "x": 0, "y": 0, "z": 0 },
"rotationDeg":{ "x": 0, "y": 0, "z": 0 },
"scaleMm":    { "x": 1, "y": 1, "z": 1 }
```

Non-identity transforms are a smell. They are allowed **only** when:

1. the STEP genuinely is not KLC-aligned (community / SnapEDA / Ultra Librarian
   exports), **and**
2. the correction is justified by the orientation gate passing **and** a
   visual-audit image in the contact sheet, **and**
3. the reason is noted in the sidecar (see "Documented exceptions").

History: the LED models once carried `rotationDeg.x = -90` and the pin
headers/sockets `rotationDeg.y = 90`. Both were wrong guesses — those STEPs are
Z-up — and were applied twice (baked into the GLB _and_ re-applied at render),
tipping the parts through the board. They are now identity.

### Documented exception: pin header / socket `scaleMm.y = -1`

The vertical pin header/socket STEPs author their pin row extending into **−Y**
from the origin, but the footprint pads sit at **+Y** (e.g. y = 0 and y = 2.54,
centre +1.27). `scaleMm: { x: 1, y: -1, z: 1 }` mirrors the row into +Y so the
pins land on the pads. The orientation gate's XY-centre check verifies this
(identity fails by 2.54 mm; the mirror passes), and it is confirmed visually in
the contact sheet. This mirror is **required** — do not remove it.

Declare a required transform in the import manifest rather than hand-editing the
sidecar after the fact. A manifest-declared model transform **survives
`--allow-overwrite`**, whereas a hand-applied one is regenerated away from KiCad
defaults on the next re-import. Either way, run `audit:3d` after any re-import:
a declared transform that never actually reached the sidecar looks exactly like a
correct one until the gate reads the baked bounds.

## Bake policy

Transforms are **baked into the GLB at pack time** (`pack.ts` →
`@openpcb/step-to-glb`, `axisCorrection: "none"`). The manifest entry then
carries `transformBaked: true`.

- `axisCorrection: "none"` is correct because KLC STEPs are pre-aligned Z-up.
  (The smallest-bbox-axis auto-rotate heuristic is **not** used at pack — it would
  silently "fix" and thereby hide non-compliant sources. The gate flags those
  instead.)
- **Render-time must not re-apply a baked transform.** When `transformBaked` is
  true the OpenPCB importer writes a null `model_ref_json`; applying the transform
  a second time is the double-apply bug. There is an importer assertion guarding
  this.

## Orientation gate (what "correct" means, mechanically)

`tools/orientation-gate.ts` checks the baked GLB bounds against the footprint
(`bun run audit:3d`, run as a release gate in CI). Mount type comes from the
footprint (`smd` vs `through_hole`); posture from the name (`_Vertical` /
`_Horizontal`).

| Check       | SMD                                                                      | THT (through-hole)                       |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| on-board    | `min.z ≥ −0.1` (base on board)                                           | leads may dip; body `max.z ≥ 0.5`        |
| up-axis     | `max.z > 0.1` (has height)                                               | vertical parts: Z extent should dominate |
| xy-centre   | model XY centre ≈ footprint reference centre, tol `max(0.4, 0.3·extent)` |
| xy-coverage | model XY extent within `[0.4, 3.0]×` footprint extent                    |
| scale       | every extent finite, `0.05–200 mm` (catches unit errors)                 |

An **error** fails the release gate; **warnings/reviews** are advisory.

> The footprint reference extent used by the XY checks comes from
> `referenceBounds()` in `tools/orientation-gate.ts`. **Which footprint geometry
> that function actually sums is not documented here and has not been
> re-verified** — earlier prose in this repo described it in a way that turned out
> to be wrong, and a wrong description here is worse than none. Read the function
> before reasoning about a marginal xy-centre or xy-coverage result, and update
> this note once it is confirmed.

### Calibration for long-lead and vertical through-hole parts

Vertical THT parts are physically correct and geometrically awkward: long leads
sit well below the board, and the body is often offset behind the pad row rather
than centred on it. The gate was calibrated for this rather than being relaxed
wholesale, and the whole vertical set — the TO-220 regulator family, DHT11, the
PS1240 buzzer and the rest — now passes with **zero warnings**. The knobs:

- **`THT_LEAD_BELOW_VERTICAL = 12`** — the below-board lead budget in millimetres
  for a vertical THT posture, replacing the flat "more than 6 mm below the board
  is an error" rule that was hard-erroring on correct geometry.
- **Body-behind-pads XY downgrade** — a body offset behind the pad row demotes
  the XY finding from error to review rather than failing outright.
- **Body-behind-pads within 0.6 × depth passes outright** — an offset inside that
  fraction of the part's depth is normal for a vertical part and is not reported
  at all.
- **Up-axis compares against the minimum horizontal axis** rather than the
  overall extent. A long pin row would otherwise dominate the bounding box and
  make a correctly upright part look as though its height did not dominate.
- **Thin-standing coverage waiver** — a tall, thin part standing on a small
  footprint legitimately falls outside the `[0.4, 3.0]×` coverage band; the waiver
  covers that shape rather than forcing a fake scale.

Two per-model sidecar overrides exist for the cases calibration cannot generalise:

| Override             | Use it for                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `orientationHint`    | a posture the footprint name does not encode (the DHT11's seated posture)   |
| `belowBoardBudgetMm` | a part with legitimately uncut leads (PS1240) or locating posts (18650)     |

Reach for these only after the calibrated rules have genuinely failed on correct
geometry. They are documented exceptions, not a way to make a red gate green.

## Which tool answers which question

| Question | Tool |
| --- | --- |
| Which models did the gate flag, and by how much? | `bun run audit:3d`, then read `dist/audit-3d-placement/report.html` for the per-model numbers |
| Is this model's body up, its pins on the pads, its polarity right? | `bun tools/render-3d-contact-sheet.ts --only=<name>` — top + iso renders |
| Do the 2D symbol and footprint previews look right — label overlap, courtyard, text size? | `bun tools/audit-components.ts` with rendering enabled (Playwright, local only; CI runs `--no-render`) |

## Adding or fixing a model — checklist

1. Import / place the STEP; keep the sidecar transform **identity** unless the
   STEP is non-KLC. If a correction is genuinely needed, declare it in the import
   manifest so it survives re-import.
2. `bun tools/pack.ts --version=0.0.0-dev --write-bounds` → regenerates GLBs, writes
   `boundsMm` / `boundsMinMm` / `boundsMaxMm` into the sidecar.
3. `bun tools/audit-3d-placement.ts --release` → must be green (no error findings).
4. `bun tools/render-3d-contact-sheet.ts --only=<name>` → eyeball top + iso:
   body on +Z, pins/pads aligned, polarity right.
5. `bun test` → orientation + golden-bounds snapshots pass.

[M2.2]: https://klc.kicad.org/model/m2/m2.2/
[F9.3]: https://klc.kicad.org/footprint/f9/f9.3.html
