/** Verify the whole input package against an integrity-pinned published tarball. */
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function assertClosure(dependencies, lock, spec) {
  const names = Object.keys(dependencies).filter(name => /^@deepseek-ai\/dsh(?:-[a-z0-9-]+)?$/u.test(name)).sort()
  const locked = Object.keys(lock.packages).sort()
  if (lock.baseVersion !== spec.baseVersion || names.length !== locked.length || names.some((name, index) => name !== locked[index])) throw new Error('Published closure is incomplete or contains unexpected packages')
  for (const [name, patch] of Object.entries(spec.packages)) {
    if (!names.includes(name) || patch.baseIntegrity !== lock.packages[name].integrity) throw new Error(`Patched package provenance missing or mismatched: ${name}`)
  }
  for (const name of names) {
    const entry = lock.packages[name]
    const short = name.slice('@deepseek-ai/'.length)
    if (entry.version !== spec.baseVersion || entry.tarball !== `https://registry.npmjs.org/@deepseek-ai/${short}/-/${short}-${spec.baseVersion}.tgz` || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)) throw new Error(`Invalid published lock: ${name}`)
  }
  return names
}

export function assertIntegrity(bytes, integrity) {
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('Published tarball integrity mismatch')
}

export async function publishedTarball(cache, name, entry) {
  await mkdir(cache, { recursive: true })
  const file = join(cache, `${name.slice('@deepseek-ai/'.length)}-${entry.version}.tgz`)
  let bytes
  try { bytes = await readFile(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (bytes === undefined) {
    const response = await fetch(entry.tarball, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Published tarball download failed (${response.status}): ${name}`)
    bytes = Buffer.from(await response.arrayBuffer())
    assertIntegrity(bytes, entry.integrity)
    await writeFile(file, bytes, { flag: 'wx' })
  }
  assertIntegrity(bytes, entry.integrity)
  return file
}

function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Published archive validation failed: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}

async function inventory(directory) {
  const entries = []
  async function visit(root, prefix = '') {
    for (const item of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === 'node_modules' || item.name === '.build') continue
      const file = join(root, item.name), path = `${prefix}${item.name}`
      const stat = await lstat(file)
      if (stat.isDirectory()) await visit(file, `${path}/`)
      else if (stat.isFile()) entries.push([path, createHash('sha256').update(await readFile(file)).digest('hex'), stat.mode & 0o111])
      else throw new Error(`Published package contains unsupported filesystem entry: ${path}`)
    }
  }
  await visit(directory)
  return JSON.stringify(entries)
}

export async function verifyPublishedPackage(input, archive, integrity, temporaryRoot) {
  assertIntegrity(await readFile(archive), integrity)
  const names = tar(['-tzf', archive]).trim().split('\n')
  if (!names.length || names.some(name => !/^package(?:\/|$)/u.test(name) || name.split('/').some(part => part === '..' || part === '.') || name.includes('\\'))) throw new Error('Unsafe published archive path')
  if (tar(['-tvzf', archive]).trim().split('\n').some(line => !/^[-d]/u.test(line))) throw new Error('Published archive links or special files are unsupported')
  const extracted = await mkdtemp(join(temporaryRoot, 'published-'))
  try {
    tar(['-xzf', archive, '-C', extracted, '--strip-components=1'])
    if (await inventory(input) !== await inventory(extracted)) throw new Error('Complete published package contents mismatch')
  } finally { await rm(extracted, { recursive: true, force: true }) }
}
