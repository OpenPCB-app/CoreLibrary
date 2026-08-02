# Authoring content waves

For the maintainer or agent adding components in bulk. It assumes you have read
[CONTRIBUTING.md](../CONTRIBUTING.md) for the id convention, the provenance rules and the gate
semantics; this file is the operational half — where the KiCad ground truth lives, how a wave
runs, how to write a manifest, and which mistakes cost the most time.

Nothing here is dated and nothing here is a resume point. For what is currently in flight, read
[STATUS.md](../STATUS.md).

One piece of negative knowledge, since older documents pointed at it: the original expansion spec
and the `~/.claude/plans/*` files are gone from disk and are not recoverable. Don't hunt for them.
The manifests under `tools/manifests/` are the surviving record of how the library was built.

## Ground truth — do not re-derive

- KiCad libraries are vendored at **`../references/kicad-libs`**, pinned to **KiCad 10.0.4 @
  `c7e226a49`**. Verify the checkout with `bun run fetch:kicad-libs`. The 10.0.4 tag is
  byte-identical to the pinned commit — footprint and STEP SHA-256 both match exactly — so the
  provenance stamp is correct as it stands.
- Symbols are **unpacked per-symbol files**: `kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym`.
  There is no packed `<Lib>.kicad_sym#Name` form in KiCad 10.
- **Transistors live in `Transistor_BJT` and `Transistor_FET`, not `Device`.** Verify any symbol
  name exists in the pinned checkout before writing it into a manifest.
- Datasheets are **link-only**. Set `datasheet` to a manufacturer URL for function parts and `null`
  for generics. `datasheetSource` is auto-captured from the KiCad symbol and is left alone.
- **`kicad-packages3D` is a blobless + sparse partial clone.** A missing STEP therefore usually
  means "not fetched yet", not "not upstream". Sparse-check out each wave's shape directories
  before importing:

  ```bash
  git -C ../references/kicad-libs/kicad-packages3D sparse-checkout add <Lib>.3dshapes
  ```

  Forgetting this makes a whole family look absent and is the most common false "we can't do this
  part" conclusion.

Two things older notes asserted that are **no longer true**, recorded so nobody re-derives them
from a stale source: this repo *does* have a bulk KiCad importer (`tools/import-kicad-batch.ts`,
driven by manifests), and `step-to-glb` is *not* browser-only — it has a Node path and pack uses
it.

## Per-wave workflow

Work from the repository root; every path below is repo-relative.

```bash
git checkout -b feat/corelib-<phase>          # one branch per wave

# 1. author tools/manifests/<phase>.json
#    template: tools/manifests/TEMPLATE.jsonc; examples: the shipped manifests in that directory.
#    For many-part or high-pin waves, generate the pinMaps rather than typing them:
bun tools/gen-pinmap.ts --footprint=<path-to-.kicad_mod>

# 2. dry-run, then the real import. Note the --flag=value form.
bun tools/import-kicad-batch.ts --manifest=tools/manifests/<phase>.json \
    --kicad-root=../references/kicad-libs --strict --dry-run
bun tools/import-kicad-batch.ts --manifest=tools/manifests/<phase>.json \
    --kicad-root=../references/kicad-libs --strict
    # add --allow-overwrite ONLY when deliberately reusing existing asset ids

# 3. check 3D placement. If the wave reused ids, confirm no hand-tuned transform was clobbered.
bun run audit:3d

# 4. the gates — all must pass
bun tools/validate.ts --release --strict
bun run audit:3d                              # N ok / 0 errors (warnings are advisory)
bun tools/audit-components.ts --no-render
bun run typecheck
bun test
bun tools/pack.ts --version=0.0.0-dev         # bakes GLBs; sanity only, the .opclib is gitignored
```

Then open a PR. `validate.yml` runs the same list.

Before you believe a green run, `bun run shared:status`. If `shared:link` is still active you are
testing unreleased `../shared` code and CI is not.

## Manifest authoring recipe

Copy a verified entry from an existing manifest in `tools/manifests/` rather than starting blank.
Per component:

- **`id`** — `openpcb.core.<category>.<slug>`, slugs hyphenated (`schottky-ss14`). A new category is
  just a new folder; no registration step.
- **`symbol.path`** — `kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym`. The importer follows
  `extends` recursively, so point this at the *named child*, not the base symbol.
- **`footprints[].path`** — `kicad-footprints/<Lib>.pretty/<FP>.kicad_mod`.
- **`footprints[].model.path`** — `kicad-packages3D/<Lib>.3dshapes/<FP>.step`. Confirm the `.step`
  actually exists (after sparse-checkout) before relying on it. If the part legitimately has no 3D
  body, use the component-level `no3d` flag instead of inventing a model.
- **`pinMap`** — see below.
- **`parameters` / `keywords` / `subcategory`** — fill these for `ic`, `power` and `sensor`. Empty
  yields a soft note, not a failure. Generics may carry a light `type`; copy the existing passives.
- **`datasheet`** — a manufacturer URL for function parts, omitted or `null` for generics.

Two manifest features worth knowing because they remove whole classes of churn:

- **`existing: true`** on a footprint reference shares an already-imported package asset without
  minting a new UUID.
- **`symbol.pinless`** handles zero-pin graphic symbols.
- A manifest may **declare model transforms**, which is how a required y-mirror survives a
  re-import (see the gotcha below).

### The two pinMap rules

1. **`pinMap` must cover every symbol pin**, and under `--strict` **every footprint pad must be
   mapped** as well. `--strict` never auto-fills. For standard parts where symbol pin numbers equal
   pad numbers the map is pure identity (`{pinNumber: n, padNumber: n}` per pad) — generate it from
   the pad list with `tools/gen-pinmap.ts` rather than hand-typing it. Use `padOverride` to map a
   non-electrical pad to its electrical pin (the SOT-223 tab, a barrel jack's `MP` mounting pad).
   Empty unnumbered NPTH pads are skipped by `isElectricalPadNumber` and do not need mapping.
2. **Omit `pinName`** unless it exactly matches the symbol's pin name. A mismatch fails `--strict`,
   and a name you guessed is worse than no name at all.

For multi-unit and high-pin parts (MCUs, logic families) let the importer's pin↔pad check drive the
map. Don't hand-guess; `validate` fails on any unmapped symbol pin anyway, and the failure arrives
later and reads worse.

## Recon one-liners

These save real time when sizing up a family:

```bash
ls ../references/kicad-libs/kicad-footprints/<Lib>.pretty/ | grep <pattern>
ls ../references/kicad-libs/kicad-packages3D/<Lib>.3dshapes/<FP>.step   # STEP present?
grep -oE '\(pad "[^"]+"' ../references/kicad-libs/kicad-footprints/<Lib>.pretty/<FP>.kicad_mod | sort -u   # pad numbers
grep -oE '\(number "[^"]+"' ../references/kicad-libs/kicad-symbols/<Lib>.kicad_symdir/<Name>.kicad_sym     # symbol pins
```

To check a symbol exists at all:

```bash
ls ../references/kicad-libs/kicad-symbols/<Lib>.kicad_symdir/ | grep <Name>
```

## Gotchas

**`--allow-overwrite` clobbers hand-tuned 3D fixes — but there is now a durable fix.** Re-importing
a footprint regenerates its `3d/<category>/<slug>.model.json` from KiCad defaults, wiping a
hand-applied `scaleMm.y: -1` (the DIP and vertical-connector y-mirror). The old workaround was to
re-run `audit:3d` after every re-import and re-apply the flip by hand. That is still the right
safety net, but it is no longer the only tool: **a manifest can declare the model transform**, and
a declared transform survives `--allow-overwrite`. Prefer declaring it in the manifest. Run
`audit:3d` afterwards either way — a declared transform that was never actually written is
indistinguishable from a correct one until the gate looks at the baked bounds.

**Prefer all-new asset ids per wave.** Importing without `--allow-overwrite` means nothing gets
clobbered and nothing needs re-flipping. Reuse a shared id only when the asset genuinely is the
same KiCad footprint already in the library (`package.sot-23`, `package.to-92-inline`). Note that a
*second* asset carrying the same KiCad footprint **name** fails `validate` with a duplicate-name
error — reuse the existing id rather than minting a parallel one.

**Don't reuse a generic symbol id across components.** `Q_NMOS_GSD`, `LED`, `Conn_01x04` and
friends: the importer names the shared symbol after the *last* component that referenced it, so the
name bleeds. Give each part its own symbol id.

**Don't duplicate R/C/L.** They are already extensive. Extend `footprints[]` on the existing
component instead of minting a new one; a duplicate `L_0805` or `Crystal_3215` trips the
duplicate-name failure above.

**`--flag=value` form only.** `--manifest=x`, `--version=x`. A space-separated flag parses as an
unknown flag.

**Not every footprint needs a STEP.** The old rule was that
`bun tools/validate.ts --release --strict` requires
one STEP-backed model per footprint and therefore any part without an upstream STEP defers to a
later wave. That is now qualified by the **`no3d` exemption**: mounting holes, fiducials, test
points and a small set of assembly-only electrical parts legitimately have no 3D body, and the
importer and validator both honour the flag. The gate stays hard for everything else — `no3d` is
not an escape hatch for a STEP that is merely inconvenient to fetch. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the policy.

**Long-lead vertical THT no longer trips the orientation gate.** Older notes list TO-220, DHT11 and
the PS1240 buzzer as known false positives to be deferred. They are not: the gate was recalibrated
and the whole set now runs at **0 warnings**. The knobs that made that possible — the lead budget,
the body-behind-pads downgrade, the up-axis rule for long pin rows, the thin-standing waiver, and
the `orientationHint` / `belowBoardBudgetMm` sidecar overrides — are documented in
[3d-placement-convention.md](3d-placement-convention.md). If one of these parts fails today,
something regressed; do not "fix" it by faking an offset.

**The prettier hook reflows files after each edit.** Re-read a region before a follow-up edit if an
anchor may have moved.

**Determinism check:** `integrity.packageSha256` differs between *any* two pack runs, because it
covers `library.generatedAt`. To compare two packs for real, compare the manifests **minus
`integrity`**.

**If a pack dies mid-conversion**, set `OPCLIB_PACK_VERBOSE` to trace each model to stderr. A WASM
abort kills the process outright and cannot be caught, so the last traced model is the only clue to
where it died — and it is usually not the faulty one.

## Cross-repo touchpoints

Only relevant when a change has to leave this repo.

**The app's import path:**
`OpenPCB/src/modules/library/backend/sync/{opclib-importer,opclib-reader,bootstrap}.ts` ·
component table `OpenPCB/src/modules/library/backend/schema.ts` · detail UI
`OpenPCB/src/modules/library/frontend/{ComponentDetailPage,components/DetailsCard}.tsx`.

**Carrying a new component field:** `@openpcb/opclib-pack` lives in `../shared`. Bump its
`component.schema.json` and its version, then update the dependency pin in **both**
`CoreLibrary/package.json` and `OpenPCB/package.json`. Shared tags must be pushed before either
consumer, because the consumers' `package.json` pins reference those tags — until the tag exists,
CI cannot resolve it.

**A regression trap to check before tagging a shared importer.** `kicad-import`'s
`normalizeFootprint` once resolved `pkg.code` but forwarded only `imperial` and `metric`.
Twenty-one footprints carry a populated `package.code` today *only because* the round that produced
them ran through `shared:link` against uncommitted shared source. Tagging `kicad-import` from
committed HEAD without checking would have silently regressed them. Before cutting a shared tag,
confirm that the behaviour your content depends on is actually in the commit you are tagging, not
just in your working copy.

## Release safety

**Never tag or publish a release without an explicit go-ahead.** `release.yml` fires on any `v*` tag
and publishes a public GitHub Release. The full release procedure, including the fail-closed
signing requirement, is in the [README](../README.md) and [keys/README.md](../keys/README.md).
