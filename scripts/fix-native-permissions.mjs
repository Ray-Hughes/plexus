import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * node-pty ships N-API prebuilds, which are ABI-stable across Node and
 * Electron — so nothing needs compiling. But npm does not preserve the
 * executable bit when it packs a tarball, and on macOS and Linux node-pty
 * execs a `spawn-helper` binary from that prebuild. Without +x, every spawn
 * fails with a bare `posix_spawnp failed.` that names nothing useful.
 *
 * Restoring the bit here keeps the whole toolchain requirement at zero: no
 * Xcode, no Visual Studio, no Python, on any machine or CI runner.
 */

const HELPERS = ['spawn-helper']

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prebuilds = join(root, 'node_modules', 'node-pty', 'prebuilds')

if (!existsSync(prebuilds)) {
  process.exit(0)
}

let fixed = 0
for (const platform of readdirSync(prebuilds)) {
  for (const helper of HELPERS) {
    const path = join(prebuilds, platform, helper)
    if (!existsSync(path)) continue
    const mode = statSync(path).mode
    if (mode & 0o111) continue
    chmodSync(path, mode | 0o755)
    fixed += 1
    process.stdout.write(`  +x node-pty/prebuilds/${platform}/${helper}\n`)
  }
}

if (fixed === 0) process.stdout.write('  native prebuild permissions already correct\n')
