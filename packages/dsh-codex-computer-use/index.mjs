/** Explicitly loaded experimental companion; importing Codex Connect does not enable this plugin. */
import Schema from '@deepseek-ai/schemastery'
import { createRequire } from 'node:module'
import { computerUseTool, PRESET } from './worker.mjs'

export const name = 'codex-computer-use'
export const inject = ['agents', 'tools', 'systemPrompt', 'agentPresets', 'computerUse']
export const Config = Schema.object({
  enabled: Schema.boolean().default(false),
  application: Schema.string().default(''),
  windowId: Schema.number().natural().default(0),
  maxDurationMs: Schema.number().min(1000).max(180000).default(90000),
  maxSteps: Schema.number().natural().min(1).max(60).default(30),
  maxOperations: Schema.number().natural().min(1).max(120).default(60),
})

export async function apply(ctx, config) {
  if (!config.enabled) return
  if (process.platform !== 'darwin') throw new Error('Computer Use currently requires macOS')
  const require = createRequire(import.meta.url)
  for (const name of ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-cua', '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-experimental-cua-macos']) {
    if (require(`${name}/package.json`).version !== '0.2.2-alpha.2') throw new Error('Computer Use requires the exact verified DSH 0.2.2-alpha.2 package set')
  }
  const releasePreset = await ctx.agentPresets.register({ id: PRESET, name: 'Bounded Terra Computer Use', plugins: [] })
  ctx.effect(() => releasePreset, 'codex-computer-use.preset')
  // DSH owns the sole CUA provider. Its existing `cua` entry must target PRESET;
  // never create a second provider or change its grants here.
  if (ctx.computerUse.providerName !== 'dsh-cua') throw new Error('The official DSH CUA provider must be loaded')
  ctx.tools.register(computerUseTool(ctx, config))
}
