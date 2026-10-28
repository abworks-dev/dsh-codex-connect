/** Keyless exact-published-Host composition check; never uses a daily profile or native driver. */
import { cp, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBoundedCommand } from './bounded-command.mjs'
import { scrubCanaryEnvironment } from './canary-environment.mjs'
import { resolveExactDshOverrides, exactDshFixtureManifest, readDshRegistryManifest } from './exact-dsh-fixture.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = '0.2.2-alpha.2'
const supplied = process.env.DSH_CUA_FIXTURE
const fixture = supplied ? resolve(supplied) : await mkdtemp(join(tmpdir(), 'codex-cua-published-host-'))
const env = { ...scrubCanaryEnvironment(process.env), NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_GLOBALCONFIG: '/dev/null', DSH_TELEMETRY_MODE: 'DISABLED' }
async function command(binary, args) {
  const result = await runBoundedCommand(binary, args, { cwd: fixture, env, timeoutMs: 15 * 60 * 1000 })
  if (result.status !== 0 || result.error) throw new Error(`${binary} check failed: ${result.stderr.slice(-4000)}\n${result.stdout.slice(-4000)}`)
  return result
}
try {
  if (!supplied) {
    const overrides = await resolveExactDshOverrides(version, readDshRegistryManifest)
    await writeFile(join(fixture, 'package.json'), JSON.stringify(exactDshFixtureManifest(overrides)))
    await command('pnpm', ['--ignore-workspace', '--config.minimum-release-age=0', 'install', '--ignore-scripts'])
  }
  const require = createRequire(join(fixture, 'package.json'))
  for (const name of ['dsh', 'dsh-agent', 'dsh-tools', 'dsh-agent-preset-registry', 'dsh-cua', 'dsh-tool-executor-native', 'dsh-experimental-cua-macos']) {
    if (require(`@deepseek-ai/${name}/package.json`).version !== version) throw new Error(`Wrong exact Host package: ${name}`)
  }
  const candidate = await mkdtemp(join(fixture, 'computer-use-candidate-'))
  try {
    await cp(join(root, 'packages/dsh-codex-computer-use'), candidate, { recursive: true })
    const result = await command(process.execPath, ['--test', join(candidate, 'test/host.test.mjs')])
    process.stdout.write(result.stdout)
    const report = { schemaVersion: 1, dshVersion: version, provider: 'scripted_in_memory', cuaTransport: 'synthetic', realModelRequests: 0, desktopActions: 0, parityAccepted: false }
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } finally { await rm(candidate, { recursive: true, force: true }) }
} finally { if (!supplied) await rm(fixture, { recursive: true, force: true }) }
