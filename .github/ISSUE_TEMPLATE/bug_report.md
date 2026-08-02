---
name: Bug report
about: Something in the library is wrong — a bad pin map, a misplaced 3D model, a failing gate
title: "[bug] "
labels: bug
assignees: ""
---

## What is wrong

<!-- One or two sentences. What did you expect, and what happened instead? -->

## Affected asset

Give the dotted id. Components carry no kind segment; symbols, footprints and 3D models do:

- Component: `openpcb.core.<category>.<slug>` — e.g. `openpcb.core.passive.resistor`
- Symbol: `openpcb.core.symbol.<category>.<slug>` — e.g. `openpcb.core.symbol.passive.resistor`
- Footprint: `openpcb.core.footprint.<category>.<slug>` — e.g. `openpcb.core.footprint.passive.r-0603`
- 3D model: `openpcb.core.3d.<category>.<slug>` — e.g. `openpcb.core.3d.passive.r-0603`

Id(s):

## How to reproduce

<!-- Steps, or the command you ran. If it shows up in the OpenPCB app rather than in this repo,
     say which app version and which pack you had installed. -->

## Gate output

If a gate fails, paste the relevant output:

```
bun tools/validate.ts --release --strict
```

Other gates, if relevant: `bun run audit:3d`, `bun tools/audit-components.ts --no-render`,
`bun tools/check-datasheet-links.ts`, `bun test`.

## Environment

- CoreLibrary commit or release tag:
- Bun version (`bun --version`), if you ran the tools locally:
- OpenPCB app version, if the bug shows up there:

---

For contribution rules, the id convention and the gate semantics, see
[CONTRIBUTING.md](../../CONTRIBUTING.md). Security issues go to
[SECURITY.md](../../SECURITY.md), **not** here.
