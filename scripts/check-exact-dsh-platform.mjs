/** Registry-backed fixture installation only: no profile, model or desktop execution. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runBoundedCommand } from './bounded-command.mjs'
import { scrubCanaryEnvironment } from './canary-environment.mjs'
import { exactDshFixtureManifest, readDshRegistryManifest, resolveExactDshOverrides } from './exact-dsh-fixture.mjs'

const version = '0.2.2-alpha.2'
const native = '@deepseek-ai/dsh-experimental-cua-macos'
const directory = await mkdtemp(join(tmpdir(), 'dsh-optional-platform-'))
try {
  const fixture = exactDshFixtureManifest(await resolveExactDshOverrides(version, readDshRegistryManifest))
  assert.equal(fixture.overrides[native], version)
  assert.equal(fixture.dependencies[native], undefined)
  await writeFile(join(directory, 'package.json'), JSON.stringify(fixture))
  await writeFile(join(directory, 'user.npmrc'), '')
  await writeFile(join(directory, 'global.npmrc'), '')
  const env = scrubCanaryEnvironment(process.env)
  // Do not inherit platform overrides, --force or peer-check exemptions.
  for (const name of Object.keys(env)) if (/^npm_config_/iu.test(name)) delete env[name]
  Object.assign(env, { NPM_CONFIG_USERCONFIG: join(directory, 'user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(directory, 'global.npmrc'), NPM_CONFIG_CACHE: join(directory, 'cache'),
    DSH_HOME: join(directory, 'unused-home'), DSH_TELEMETRY_MODE: 'DISABLED' })
  // Reuse the matrix's existing pinned acceptance installer when supplied.
  const installer = process.env.MATRIX_NPM_CLI
  const command = installer ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const prefix = installer ? [resolve(installer)] : []
  const result = await runBoundedCommand(command,
    [...prefix, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: directory, env, timeoutMs: 300_000 })
  if (result.error || result.cleanupError || result.status !== 0) {
    throw new Error(`Exact fixture install failed: ${result.error?.message ?? result.cleanupError?.message ?? result.stderr.slice(-4000)}`)
  }
  for (const [name, expected] of Object.entries(fixture.dependencies)) {
    const metadata = JSON.parse(await readFile(join(directory, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(metadata.name, name)
    assert.equal(metadata.version, expected)
  }
  let installedNative
  try { installedNative = JSON.parse(await readFile(join(directory, 'node_modules', native, 'package.json'), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (process.platform === 'darwin') assert.equal(installedNative?.version, version)
  else assert.equal(installedNative, undefined, 'npm must skip the upstream darwin-only optional package')
  console.log(JSON.stringify({ version, platform: process.platform, architecture: process.arch,
    requiredPackages: Object.keys(fixture.dependencies).length, exactPins: Object.keys(fixture.overrides).length,
    nativePackageInstalled: installedNative !== undefined, scope: 'fixture-install-only', compatibilityAccepted: false }))
} finally { await rm(directory, { recursive: true, force: true }) }
