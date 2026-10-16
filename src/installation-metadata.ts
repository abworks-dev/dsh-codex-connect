/** Bounded, read-only package metadata; never import peers or search ancestor installations. */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRuntimeMetadataVersion } from './runtime-identity.ts'

const PLUGIN_PACKAGE = 'dsh-codex-connect'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const MAX_MANIFEST_BYTES = 256 * 1024
const PLUGIN_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
export const DSH_METADATA_PACKAGES = ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-compaction'] as const

type DshMetadataPackage = (typeof DSH_METADATA_PACKAGES)[number]

export interface DshInstallationMetadata {
  version: string
  packageVersions: Partial<Record<DshMetadataPackage, string>>
  /** Present only when all three peers agree with the selected DSH manifest. */
  currentDshVersion?: string
}

interface PackageMetadata {
  version: string
  dependencyRoots: readonly string[]
}

/** The public launch fact is an absolute manifest path, never an inferred cwd or executable. */
export function isInstallationAnchor(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && basename(value) === 'package.json'
}

async function manifestVersion(filename: string, name: string): Promise<string | null | undefined> {
  try {
    // Directory symlinks are normal pnpm topology; the manifest leaf itself must
    // be a small regular file, not a link to unrelated data or a blocking FIFO.
    const metadata = await lstat(filename)
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return null
    const manifest: unknown = JSON.parse(await readFile(filename, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return null
    const fields = manifest as Record<string, unknown>
    return fields.name === name && isRuntimeMetadataVersion(fields.version) ? fields.version : null
  } catch (error: unknown) {
    // Only an absent candidate permits trying the other explicit dependency root.
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? undefined : null
  }
}

async function packageMetadata(filename: string, name: string): Promise<PackageMetadata | undefined> {
  if (!isInstallationAnchor(filename)) return undefined
  try {
    if (!(await lstat(filename)).isFile()) return undefined
    const manifest = await realpath(filename)
    const version = await manifestVersion(manifest, name)
    if (version === undefined || version === null) return undefined
    const directory = dirname(manifest)
    const parent = dirname(directory)
    // A pnpm physical package may have peers beside it. Its exact peer symlinks
    // are allowed; there is no subsequent ancestor walk or resolver fallback.
    const installationModules = basename(parent) === 'node_modules' ? parent
      : basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules' ? dirname(parent) : undefined
    return {
      version,
      dependencyRoots: [join(directory, 'node_modules'), ...installationModules === undefined ? [] : [installationModules]],
    }
  } catch {
    return undefined
  }
}

async function dependencyVersion(name: string, metadata: PackageMetadata): Promise<string | undefined> {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) return undefined
  for (const root of metadata.dependencyRoots) {
    const version = await manifestVersion(join(root, name, 'package.json'), name)
    if (version !== undefined) return version ?? undefined
  }
  return undefined
}

/** Read only this plugin's known manifest; the path seam is for isolated fixtures. */
export async function readInstalledPluginVersion(pluginManifestPath = PLUGIN_MANIFEST): Promise<string | undefined> {
  return (await packageMetadata(pluginManifestPath, PLUGIN_PACKAGE))?.version
}

/** Read one dependency from this plugin's own two logical lookup roots only. */
export async function readPluginDependencyVersion(name: string, pluginManifestPath = PLUGIN_MANIFEST): Promise<string | undefined> {
  const metadata = await packageMetadata(pluginManifestPath, PLUGIN_PACKAGE)
  return metadata === undefined ? undefined : dependencyVersion(name, metadata)
}

/** An invalid explicit anchor is unknown, never a reason to try local/global packages. */
export async function readDshInstallationMetadata(installAnchor: string): Promise<DshInstallationMetadata | undefined> {
  const metadata = await packageMetadata(installAnchor, DSH_PACKAGE)
  if (metadata === undefined) return undefined
  const entries = await Promise.all(DSH_METADATA_PACKAGES.map(async name => [name, await dependencyVersion(name, metadata)] as const))
  const packageVersions = Object.fromEntries(entries.filter(([, version]) => version !== undefined)) as Partial<Record<DshMetadataPackage, string>>
  return {
    version: metadata.version,
    packageVersions,
    ...DSH_METADATA_PACKAGES.every(name => packageVersions[name] === metadata.version)
      ? { currentDshVersion: metadata.version } : {},
  }
}
