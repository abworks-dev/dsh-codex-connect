import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, copyFile, rm, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Exercise check-pack's actual spawn call without running npm or a shell.
const originalSpawn = childProcess.spawnSync
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const sentinel = new Error('pack invocation observed')
const names = ['ComSpec', 'COMSPEC', 'comspec', 'ComSpEc']
const previous = new Map(names.map(name => [name, process.env[name]]))
const directory = await mkdtemp(join(tmpdir(), 'pack & space (%PACK_ENV%) -'))
const scripts = join(directory, 'scripts')
await mkdir(scripts)
await copyFile(new URL('./check-pack.mjs', import.meta.url), join(scripts, 'check-pack.mjs'))
await copyFile(new URL('./pack-lib-inventory.mjs', import.meta.url), join(scripts, 'pack-lib-inventory.mjs'))
try {
  for (const platform of ['linux', 'win32']) for (const entry of [new URL('./check-pack.mjs', import.meta.url), pathToFileURL(join(scripts, 'check-pack.mjs'))]) {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    for (const name of [undefined, ...names]) {
      for (const key of names) delete process.env[key]
      if (name) process.env[name] = 'C:\\Windows & space\\System32\\cmd.exe'
      childProcess.spawnSync = (command, args, options) => {
        assert.equal(command, platform === 'win32'
          ? process.env.ComSpec ?? process.env.COMSPEC ?? process.env.comspec ?? 'cmd.exe'
          : 'npm')
        if (platform === 'win32') {
          assert.deepEqual(args, ['/d', '/s', '/c', '"npm.cmd pack --dry-run --json --ignore-scripts"'])
          assert.equal(options.windowsVerbatimArguments, true)
        } else {
          assert.deepEqual(args, ['pack', '--dry-run', '--json', '--ignore-scripts'])
          assert.equal(options.windowsVerbatimArguments, false)
        }
        assert.equal(options.shell, undefined)
        assert.equal(options.windowsHide, true)
        assert.equal(realpathSync(options.cwd), realpathSync(new URL('..', entry)))
        assert.ok(!args.some(argument => argument.includes('Windows & space')))
        throw sentinel
      }
      syncBuiltinESMExports()
      await assert.rejects(import(`${entry.href}?platform=${platform}&shell=${name ?? 'default'}`), error => error === sentinel)
    }
    process.stdout.write(`ok - literal ${platform} shell text, preserved shell-selection aliases and source-directory metacharacters\n`)
  }
} finally {
  Object.defineProperty(process, 'platform', platformDescriptor)
  childProcess.spawnSync = originalSpawn
  syncBuiltinESMExports()
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await rm(directory, { recursive: true, force: true })
}
