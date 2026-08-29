import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

/**
 * Runs the suite with coverage and emits a shields.io endpoint file. CI commits
 * this, so the README badge reports the number this repo actually measured
 * rather than a hand-written one.
 */

const args = [
  '--test',
  '--experimental-test-coverage',
  '--test-reporter=tap',
  '--test-coverage-exclude=**/node_modules/**',
  '--test-coverage-exclude=test/**',
  '--test-coverage-exclude=dist/cli/**',
  'test/tasks.test.mjs',
  'test/consensus.test.mjs',
  'test/jobs.test.mjs',
  'test/coordinator.test.mjs',
  'test/store.test.mjs',
  'test/mcp.test.mjs'
]

let output = ''
try {
  output = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (err) {
  output = `${err.stdout ?? ''}${err.stderr ?? ''}`
  process.exitCode = 1
}

const line = output.split('\n').find((l) => /all files/.test(l))
if (!line) {
  console.error('could not find the coverage summary line')
  process.exit(1)
}

const [lines, branches, functions] = line
  .split('|')
  .slice(1, 4)
  .map((n) => Number.parseFloat(n.trim()))

if (!Number.isFinite(lines)) {
  console.error(`could not parse coverage from: ${line}`)
  process.exit(1)
}

const pct = Math.round(lines * 10) / 10
const color = pct >= 90 ? 'brightgreen' : pct >= 80 ? 'green' : pct >= 70 ? 'yellow' : 'orange'

mkdirSync('.github/badges', { recursive: true })

/** shields.io endpoint format — see https://shields.io/badges/endpoint-badge */
const endpoint = (label, message, color) =>
  `${JSON.stringify({ schemaVersion: 1, label, message, color }, null, 2)}\n`

writeFileSync('.github/badges/coverage.json', endpoint('coverage', `${pct}%`, color))

console.log(`lines ${lines}%  branches ${branches}%  functions ${functions}%`)
console.log(`wrote .github/badges/coverage.json → ${pct}% (${color})`)

/**
 * Also emit the badge as an SVG committed to the repo. A shields.io endpoint
 * badge can't read a private repo's raw files, but a repo-relative image
 * renders fine in GitHub's markdown — so this is the version the README uses.
 */
const COLORS = { brightgreen: '#4c1', green: '#97ca00', yellow: '#dfb317', orange: '#fe7d37' }

function badge(label, message, fill) {
  // 6.5px per char is a close enough approximation of Verdana 11 for these widths.
  const lw = Math.round(label.length * 6.5) + 10
  const mw = Math.round(message.length * 6.5) + 10
  const w = lw + mw
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${fill}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lw * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(lw - 10) * 10}">${label}</text>
    <text x="${lw * 5}" y="140" transform="scale(.1)" fill="#fff" textLength="${(lw - 10) * 10}">${label}</text>
    <text aria-hidden="true" x="${(lw + mw / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(mw - 10) * 10}">${message}</text>
    <text x="${(lw + mw / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(mw - 10) * 10}">${message}</text>
  </g>
</svg>
`
}

// The SVGs are kept as a fallback: they render from a repo-relative path even
// when shields.io can't reach the endpoint JSON (a private repo, or an outage).
writeFileSync('.github/badges/coverage.svg', badge('coverage', `${pct}%`, COLORS[color]))
// TAP indents subtests, so counting `^ok` only finds top-level suites. The
// plan summary is the number that matches what the spec reporter prints.
const passing = Number.parseInt(/^# pass (\d+)$/m.exec(output)?.[1] ?? '0', 10)
const failing = Number.parseInt(/^# fail (\d+)$/m.exec(output)?.[1] ?? '0', 10)
writeFileSync(
  '.github/badges/tests.json',
  endpoint('tests', failing ? `${failing} failing` : `${passing} passing`, failing ? 'red' : 'brightgreen')
)
writeFileSync(
  '.github/badges/tests.svg',
  badge(
    'tests',
    failing ? `${failing} failing` : `${passing} passing`,
    failing ? '#e05d44' : COLORS.brightgreen
  )
)
console.log(`${passing} passing, ${failing} failing`)
console.log('wrote .github/badges/coverage.svg and tests.svg')
