/** Pure filesystem/tar fixtures: no credentials, network, model or native driver. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { assertClosure, assertIntegrity, verifyPublishedPackage } from './provenance.mjs'

const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`
test('closure cannot omit a patched or unpatched dependency or change patch provenance', () => {
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-agent']
  const packages = Object.fromEntries(names.map(name => [name, { version: '0.2.2-alpha.2', integrity: 'sha512-YQ==', tarball: `https://registry.npmjs.org/@deepseek-ai/${name.split('/')[1]}/-/${name.split('/')[1]}-0.2.2-alpha.2.tgz` }]))
  const lock = { baseVersion: '0.2.2-alpha.2', packages }
  const spec = { baseVersion: '0.2.2-alpha.2', packages: { '@deepseek-ai/dsh-agent': { baseIntegrity: 'sha512-YQ==' } } }
  const dependencies = Object.fromEntries(names.map(name => [name, '0.2.2-alpha.2']))
  assert.deepEqual(assertClosure(dependencies, lock, spec), names)
  for (const omitted of names) assert.throws(() => assertClosure(Object.fromEntries(Object.entries(dependencies).filter(([name]) => name !== omitted)), lock, spec), /incomplete/)
  assert.throws(() => assertClosure({ ...dependencies, '@deepseek-ai/dsh-foreign': '0.2.2-alpha.2' }, lock, spec), /unexpected/)
  assert.throws(() => assertClosure(dependencies, lock, { ...spec, packages: { '@deepseek-ai/dsh-agent': { baseIntegrity: 'sha512-Yg==' } } }), /provenance/)
})

test('whole-package validation catches unpatched source tampering, extra files, missing files and archive corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-provenance-'))
  try {
    const input = join(root, 'input'), packed = join(root, 'packed'), original = join(packed, 'package'), archive = join(root, 'package.tgz')
    await mkdir(input); await mkdir(original, { recursive: true })
    for (const directory of [input, original]) {
      await writeFile(join(directory, 'patched.js'), 'original patched file\n')
      await writeFile(join(directory, 'unpatched.js'), 'original unpatched file\n')
    }
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', packed, 'package']).status, 0)
    const expected = integrity(await readFile(archive))
    await verifyPublishedPackage(input, archive, expected, root)
    await writeFile(join(input, 'unpatched.js'), 'tampered\n')
    await assert.rejects(verifyPublishedPackage(input, archive, expected, root), /contents mismatch/)
    await writeFile(join(input, 'unpatched.js'), 'original unpatched file\n')
    await writeFile(join(input, 'extra.js'), 'extra\n')
    await assert.rejects(verifyPublishedPackage(input, archive, expected, root), /contents mismatch/)
    await rm(join(input, 'extra.js')); await rm(join(input, 'unpatched.js'))
    await assert.rejects(verifyPublishedPackage(input, archive, expected, root), /contents mismatch/)
    assert.throws(() => assertIntegrity(Buffer.from('corrupt'), expected), /integrity mismatch/)
    await symlink('outside', join(original, 'link'))
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', packed, 'package']).status, 0)
    await assert.rejects(verifyPublishedPackage(input, archive, integrity(await readFile(archive)), root), /links or special/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
