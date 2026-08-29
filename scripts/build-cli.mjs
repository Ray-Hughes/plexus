import { build } from 'esbuild'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The three standalone entry points the CLIs and tmux layout use. Bundled so
 * `node dist/cli/harness-bridge.mjs` works from any project directory without
 * plexus's node_modules being present.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = resolve(root, 'dist/cli')
mkdirSync(outdir, { recursive: true })

const entries = [
  { in: 'src/main/mcp-server.ts', out: 'cli/harness-bridge' },
  { in: 'src/cli/coordinator.ts', out: 'cli/harness-coordinator' },
  { in: 'src/cli/watch.ts', out: 'cli/harness-watch' },
  // Bundled once more without the Electron surface, so the tests and any
  // non-Electron consumer exercise the same code the CLIs run.
  { in: 'src/lib.ts', out: 'lib/plexus' }
]

mkdirSync(resolve(root, 'dist/lib'), { recursive: true })

for (const entry of entries) {
  const outfile = resolve(root, 'dist', `${entry.out}.mjs`)
  await build({
    entryPoints: [resolve(root, entry.in)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    // Inline maps on the library bundle so `node --test --experimental-test-coverage`
    // attributes coverage to src/*.ts rather than to the bundled dependencies.
    sourcemap: entry.out.startsWith('lib/') ? 'inline' : false,
    // The MCP SDK pulls in optional server transports we never touch; letting
    // esbuild resolve them anyway keeps the bundle self-contained.
    banner: {
      js: [
        "import { createRequire as __plexusCreateRequire } from 'node:module';",
        "import { fileURLToPath as __plexusFileURLToPath } from 'node:url';",
        "import { dirname as __plexusDirname } from 'node:path';",
        'const require = __plexusCreateRequire(import.meta.url);',
        'const __filename = __plexusFileURLToPath(import.meta.url);',
        'const __dirname = __plexusDirname(__filename);'
      ].join('\n')
    },
    logLevel: 'warning'
  })
  if (entry.out.startsWith('cli/')) chmodSync(outfile, 0o755)
  process.stdout.write(`  dist/${entry.out}.mjs\n`)
}
