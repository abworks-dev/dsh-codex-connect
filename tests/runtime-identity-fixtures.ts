import type { OpenAICodexRuntimeReport } from '../src/runtime-identity.ts'

/** Synthetic, credential-free evidence shared by unit and real-browser tests. */
export function runtimeReport(loaded = '0.2.0-alpha.4', installed: string | null = loaded): OpenAICodexRuntimeReport {
  const supported = '0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-alpha.2 || 0.2.1-alpha.3'
  const entry = () => ({ supported, installed: '0.2.0-rc.2', status: 'compatible' as const })
  return {
    schemaVersion: 1,
    identity: {
      scope: 'host', loadedPluginVersion: loaded, installedPluginVersion: installed,
      pluginVersionState: installed === null ? 'unknown' : installed === loaded ? 'match' : 'mismatch',
      dshMetadataSource: 'host-install-anchor',
    },
    currentDshVersion: '0.2.0-rc.2',
    compatibility: {
      schemaVersion: 1, status: 'compatible',
      node: { supported: '^22.19.0 || >=24.0.0', installed: 'v24.21.0', status: 'compatible' },
      packages: {
        '@deepseek-ai/dsh-llm': entry(), '@deepseek-ai/dsh-llm-pi-ai': entry(), '@deepseek-ai/dsh-compaction': entry(),
        '@earendil-works/pi-ai': { supported: '0.85.1', installed: '0.85.1', status: 'compatible' },
      },
    },
  }
}
