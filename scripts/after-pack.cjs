const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Ad-hoc sign the macOS bundle.
 *
 * Without this, electron-builder skips signing when there is no Developer ID,
 * leaving Electron's own inherited signature on a bundle it has just modified.
 * That signature is *invalid*, not merely untrusted — `codesign --verify` fails
 * with "code has no resources but signature indicates they must be present" —
 * and macOS reports an arm64 app with a broken signature as **damaged**,
 * refuses to open it, and deletes it from disk.
 *
 * An ad-hoc signature is still untrusted, so Gatekeeper still asks. But it is
 * valid, so the user gets the ordinary "unidentified developer" path rather
 * than a file that vanishes. electron-builder cannot do this itself: it only
 * accepts a named keychain identity, not "-".
 *
 * A real Developer ID identity supersedes all of this — see docs/packaging.md.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return // real cert: leave it alone

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], {
    stdio: 'inherit'
  })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })

  console.log(`  • ad-hoc signed  ${app}`)
}
