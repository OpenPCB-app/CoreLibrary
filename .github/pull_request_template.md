## Summary

<!-- What's added/changed. -->

## Checklist

- [ ] `bun validate --release --strict` passes
- [ ] `bun test` passes
- [ ] New assets follow the `openpcb.core.<kind>.<category>.<slug>` ID convention
- [ ] Provenance fields populated (source, license, attribution, upstreamUrl, upstreamCommit, sourceHash, convertedAt, conversionTool)
- [ ] Symbol pins ↔ footprint pads cross-reference checked
- [ ] 3D model `.glb` committed alongside `.model.json` metadata (or N/A)
- [ ] No new `dist/` artifacts committed (CI handles packing)

## Notes
