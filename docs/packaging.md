# Packaging and releasing

```bash
npm run dist:mac     # dmg + zip, arm64 and x64  → release/
npm run dist:win     # NSIS installer, x64 and arm64
npm run dist         # both
npm run pack         # unpacked app dir, no installer — fastest way to test packaging
```

## The one gotcha

`electron-builder` rebuilds `node-pty` **in place** for whichever architecture it's
currently targeting. Packaging for x64 on an Apple Silicon machine therefore leaves
`node_modules/node-pty` compiled for x64, and `npm run dev` then fails with:

```
posix_spawnp failed.
```

It looks like a PATH problem — it isn't. Fix it with:

```bash
npm run rebuild      # electron-builder install-app-deps
```

The `dist:*` scripts already do this for you afterwards. It only bites when you invoke
`electron-builder` directly.

## Signing

Builds are unsigned by default, which is fine for a personal tool and not fine for handing
to anyone else.

**macOS.** Unsigned `.dmg` files trip Gatekeeper: right-click → *Open* the first time. To
sign properly you need an Apple Developer account and a *Developer ID Application*
certificate in your keychain; `electron-builder` picks it up automatically. For
distribution outside the App Store you also want notarization:

```yaml
# electron-builder.yml
mac:
  hardenedRuntime: true
  notarize:
    teamId: YOUR_TEAM_ID
```

with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in the environment.
Note that `hardenedRuntime: true` needs entitlements allowing the PTY helper to run —
`com.apple.security.cs.allow-unsigned-executable-memory` and
`com.apple.security.cs.disable-library-validation`.

**Windows.** Unsigned `.exe` files trip SmartScreen: *More info → Run anyway*. Signing
needs a code-signing certificate; point `CSC_LINK` and `CSC_KEY_PASSWORD` at it.

CI sets `CSC_IDENTITY_AUTO_DISCOVERY: false` so builds don't fail looking for a certificate
that isn't there.

## Releasing

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` fans out across `macos-latest` and `windows-latest`, runs
the test suite before building, and publishes every installer to the GitHub release. Or run
it by hand from the Actions tab with a tag as input.

## What ships

| Path in the bundle | What it is |
|---|---|
| `Contents/Resources/app.asar` | Main, preload, renderer |
| `Contents/Resources/cli/*.mjs` | The MCP server and CLI bundles — this is what a wired project points at |
| `app.asar.unpacked/…/node-pty` | Native module, unpacked because it can't load from inside an asar |

`provision.ts` resolves `Contents/Resources/cli/harness-bridge.mjs` at runtime and writes
that absolute path into a project's MCP config, launching it via the Electron binary with
`ELECTRON_RUN_AS_NODE=1` — so a wired project doesn't need `node` installed separately.
