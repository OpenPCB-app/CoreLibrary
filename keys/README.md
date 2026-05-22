# Signing Keys

Ed25519 signing for `.opclib` releases.

## Layout

- `openpcb-core.pub` — public verification key, committed; also copied into OpenPCB's `resources/keys/`.
- Private key never committed. Stored as GitHub Actions secret `OPCLIB_SIGNING_KEY` (PEM, pkcs8). The active key id is set via repo variable `OPCLIB_KEY_ID` (e.g. `openpcb-core-2026`).

## Generate a new key pair

```bash
node -e '
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync("openpcb-core.priv.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync("openpcb-core.pub", publicKey.export({ type: "spki", format: "pem" }));
'
```

Commit `openpcb-core.pub`. Upload the `.priv.pem` contents to the `OPCLIB_SIGNING_KEY` GitHub Actions secret. Set `OPCLIB_KEY_ID` repo variable to a stable identifier embedded in every signature (e.g. `openpcb-core-2026`).

## Rotation

1. Generate new pair with a new `keyId`.
2. Commit the new `.pub` and copy to `OpenPCB/resources/keys/` (both keys live there simultaneously so verifiers accept old + new during the cutover).
3. Update `OPCLIB_KEY_ID` repo variable and `OPCLIB_SIGNING_KEY` secret.
4. Cut a release; verify signature in OpenPCB.
5. After a deprecation window, remove the old `.pub`.
