# Signing keys

Ed25519 signing for `.opclib` releases. Maintainer-facing.

## Layout

- `openpcb-core.pub` — the public verification key. **Committed**, and also copied into OpenPCB's
  `resources/keys/`.
- `keys/*.priv.pem` — private keys. **Gitignored.** Never committed. Upload the contents to the
  GitHub Actions secret and then **delete the local file**; there is no reason for it to survive on
  a developer machine, and every reason for it not to.
- The active key id is set via the repository **variable** `OPCLIB_KEY_ID` (for example
  `openpcb-core-2026`) and is embedded in every signature.

## Signing is fail-closed

`release.yml` requires **both** the `OPCLIB_SIGNING_KEY` secret and the `OPCLIB_KEY_ID` variable.
If either is missing the job fails. It does not fall back to publishing an unsigned pack, and
nothing downstream is expected to accept one.

The release job also verifies both published packs — including the Ed25519 signature — against the
committed `keys/openpcb-core.pub`. That way a CI key that has drifted from the published public key
fails at release time rather than on every user's install.

## The two traps that have already bitten

**1. The app derives the key id from the `.pub` filename.** `trusted-keys.ts` in OpenPCB takes the
key id from the *name* of the file in its trust store, not from anything inside it. So a repository
that publishes its public half as `openpcb-core.pub` while the app trusts `test-2026.pub` can never
verify a signature, no matter how correct the cryptography is. **The filename committed here and
the filename in `OpenPCB/resources/keys/` must agree**, and both must match `OPCLIB_KEY_ID`. This
mismatch caused a real outage.

**2. A workflow step cannot read its own `env:` block in its own `if:`.** The `secrets` context is
not available in a step-level `if:` either. A guard written as
`if: env.OPCLIB_SIGNING_KEY != ''` on the same step that defines `OPCLIB_SIGNING_KEY` in its `env:`
is therefore **always false**, and the pack steps silently take their unsigned branch while
reporting success. Signing material must live in **job-level `env`**. If you refactor the workflow,
re-check this: it is the kind of bug that produces a green run and an unsigned artifact.

## Generate a key pair

```bash
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync("openpcb-core.priv.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync("openpcb-core.pub", publicKey.export({ type: "spki", format: "pem" }));
'
```

Then:

1. Commit `openpcb-core.pub` here, and copy the identical file into `OpenPCB/resources/keys/`.
2. `gh secret set OPCLIB_SIGNING_KEY < openpcb-core.priv.pem`
3. `gh variable set OPCLIB_KEY_ID --body openpcb-core-2026`
4. Delete the local `openpcb-core.priv.pem`.

## Rotation

1. Generate a new pair with a new key id.
2. Commit the new `.pub` and copy it to `OpenPCB/resources/keys/`. Both keys live there
   simultaneously so verifiers accept old and new during the cutover.
3. Update the `OPCLIB_KEY_ID` variable and the `OPCLIB_SIGNING_KEY` secret. Delete the local
   private key again.
4. Cut a release and verify the signature in OpenPCB — in a packaged build, not a dev run.
5. After a deprecation window, remove the old `.pub` from both repositories.

Release procedure and the rest of the gate list are in the [README](../README.md).
