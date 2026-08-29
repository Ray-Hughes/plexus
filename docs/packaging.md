# Packaging and releasing

```bash
npm run dist:mac     # dmg + zip, arm64 and x64  → release/
npm run dist:win     # NSIS installer, x64 and arm64
npm run dist         # both
npm run pack         # unpacked app dir, no installer — fastest way to test packaging
```

## No native toolchain required

`node-pty` 1.1 ships **N-API** prebuilds, which are ABI-stable across both Node and
Electron. Nothing needs compiling — no Xcode, no Visual Studio, no Python, on any machine
or CI runner. `npmRebuild: false` in `electron-builder.yml` keeps it that way.

That setting is load-bearing, not an optimisation. Letting `electron-builder` rebuild
replaces the host's prebuild with one for whatever architecture was last packaged, so
building for x64 on an Apple Silicon machine leaves `npm run dev` failing with a bare:

```
posix_spawnp failed.
```

### The one thing that does need fixing

npm does not preserve the executable bit when it packs a tarball, and on macOS and Linux
`node-pty` execs a `spawn-helper` binary out of that prebuild. Without `+x`, every spawn
fails with the same uninformative `posix_spawnp failed.`

`scripts/fix-native-permissions.mjs` runs on `postinstall` and restores it. If you ever see
that error after a fresh `npm ci`, run it by hand:

```bash
node scripts/fix-native-permissions.mjs
```

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
