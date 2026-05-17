// test/hooks/scripts/hook-wrapper.test.mjs
// Verifies the bash wrapper (hook.sh) logs failures when node is missing or
// the CLI script is unreadable. The previous wrapper unconditionally
// exited 0 — silent failures meant lost observability.

import { describe, test, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK_SH = join(__dirname, '../../../hooks/scripts/hook.sh')

let tempRoots = []

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'hook-sh-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Resolve bash by absolute path so the spawn itself isn't subject to the
// PATH override we use to hide `node` from the hook script.
const BASH = existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash'

function runHook({ pathOverride, logFile, input = '{}' }) {
  const env = {
    AGENTS_OBSERVE_HOOK_LOG: logFile,
    PATH: pathOverride,
    HOME: dirname(logFile),
  }
  return execFileSync(BASH, [HOOK_SH], {
    input,
    env,
    encoding: 'utf8',
  })
}

describe('hook.sh wrapper', () => {
  test('logs failure when node is missing from PATH', () => {
    const root = makeSandbox()
    const logFile = join(root, 'observe-hook.log')

    // PATH points only at an empty dir — no `node` discoverable.
    // PATH excludes node's typical install locations while still resolving
    // coreutils that hook.sh depends on (cat, dirname, date, mkdir).
    const emptyBin = '/bin:/usr/bin'

    // Pre-create the log dir so log_failure's mkdir is a no-op even if the
    // bash on macOS rejects writing outside HOME.
    mkdirSync(dirname(logFile), { recursive: true })

    runHook({ pathOverride: emptyBin, logFile })

    expect(existsSync(logFile)).toBe(true)
    const contents = readFileSync(logFile, 'utf8')
    expect(contents).toMatch(/node not found in PATH/)
  })

  test('logs failure when observe_cli.mjs is unreadable', () => {
    const root = makeSandbox()
    const logFile = join(root, 'observe-hook.log')

    // Build a copy of hook.sh inside the sandbox whose SCRIPT_DIR resolves
    // to a directory with NO observe_cli.mjs — emulating a corrupt install.
    const sandboxScriptDir = join(root, 'scripts')
    mkdirSync(sandboxScriptDir, { recursive: true })
    const sandboxHook = join(sandboxScriptDir, 'hook.sh')
    writeFileSync(sandboxHook, readFileSync(HOOK_SH, 'utf8'))
    chmodSync(sandboxHook, 0o755)

    mkdirSync(dirname(logFile), { recursive: true })

    execFileSync(BASH, [sandboxHook], {
      input: '{}',
      env: {
        AGENTS_OBSERVE_HOOK_LOG: logFile,
        PATH: process.env.PATH, // node is available — only the CLI is missing
        HOME: dirname(logFile),
      },
      encoding: 'utf8',
    })

    expect(existsSync(logFile)).toBe(true)
    const contents = readFileSync(logFile, 'utf8')
    expect(contents).toMatch(/observe_cli\.mjs missing or unreadable/)
  })

  test('exits 0 even on failure so Claude Code does not block', () => {
    const root = makeSandbox()
    const logFile = join(root, 'observe-hook.log')
    // PATH excludes node's typical install locations while still resolving
    // coreutils that hook.sh depends on (cat, dirname, date, mkdir).
    const emptyBin = '/bin:/usr/bin'
    mkdirSync(dirname(logFile), { recursive: true })

    // execFileSync throws on non-zero exit — reaching the assertion proves 0.
    expect(() => runHook({ pathOverride: emptyBin, logFile })).not.toThrow()
  })
})
