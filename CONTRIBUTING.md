# Contributing

```bash
npm install
npm run dev
npm test
```

## Before opening a PR

```bash
npm run typecheck && npm test
```

CI runs both across Linux, macOS and Windows, and packages the app on macOS and Windows.

## Where things go

Bridge logic belongs in `src/main/bridge/` and nowhere else. The MCP server, the Electron
IPC layer, and the terminal coordinator are all thin front doors over the `Harness` class —
if you find yourself implementing behaviour in one of them, it probably belongs in the
bridge so the other two get it too.

## Tests

The suite runs against `dist/lib/plexus.mjs` — the built artifact, not the source — so
`npm test` builds first. Source maps are inlined on that bundle so coverage maps back to
`src/*.ts`.

`test/mcp.test.mjs` drives the real MCP server over stdio with two agent identities
connected at once. It's slower than the rest and worth keeping that way: it's the only test
that proves the thing `claude` and `copilot` actually load works.

Tests that would otherwise spawn a real CLI stub `harness.dispatch`. Nothing in the suite
requires `claude` or `copilot` to be installed.

## Coverage

```bash
npm run test:coverage
npm run coverage:badge     # regenerates .github/badges/*.svg
```

CI regenerates the badge on every push to `main`.
