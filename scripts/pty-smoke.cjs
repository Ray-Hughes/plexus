/**
 * Runs under Electron, not node: node-pty is compiled against Electron's ABI,
 * so this is the only way to prove the pane will actually work in the app.
 */
const { app } = require('electron')

app.on('ready', () => {
  let pty
  try {
    pty = require('node-pty')
  } catch (err) {
    console.error('FAIL: node-pty did not load under Electron:', err.message)
    return app.exit(1)
  }

  const term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', ['-c', 'echo plexus-pty-ok && exit 0'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env
  })

  let out = ''
  term.onData((d) => {
    out += d
  })
  term.onExit(({ exitCode }) => {
    const ok = out.includes('plexus-pty-ok') && exitCode === 0
    console.log(ok ? 'PASS: node-pty spawned under Electron' : `FAIL: exit=${exitCode} out=${JSON.stringify(out)}`)
    app.exit(ok ? 0 : 1)
  })

  setTimeout(() => {
    console.error('FAIL: pty produced no output within 8s')
    app.exit(1)
  }, 8000)
})
