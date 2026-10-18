import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { selectOpenAICodexSearchRoute } from '../src/search-route-override.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('supported DSH search route override', () => {
  it('selects Codex and restores the previous provider idempotently', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-official' })

    const restore = selectOpenAICodexSearchRoute(ctx.web, 'openai-codex')
    expect(Reflect.get(ctx.web, 'searchProviderId')).toBe('openai-codex')

    restore()
    restore()
    expect(Reflect.get(ctx.web, 'searchProviderId')).toBe('deepseek-official')
  })

  it('does not overwrite a later route selected by another owner', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(WebRuntime, { searchProvider: 'deepseek-official' })

    const restore = selectOpenAICodexSearchRoute(ctx.web, 'openai-codex')
    Reflect.set(ctx.web, 'searchProviderId', 'new-owner')
    restore()

    expect(Reflect.get(ctx.web, 'searchProviderId')).toBe('new-owner')
  })

  it('rejects an unsupported runtime before changing it', () => {
    expect(() => selectOpenAICodexSearchRoute({} as WebRuntime, 'openai-codex'))
      .toThrow('does not expose the supported search route field')
  })
  function volatileHost() {
    let route: string | undefined = 'fixture-original'
    const reference = Object.freeze({ get: () => route })
    const config = { searchProvider: reference, fetchProvider: Object.freeze({ get: () => 'fixture-fetch' }) }
    const target = { config }
    return { web: target as unknown as WebRuntime, target, config, reference,
      change: (value: string | undefined) => { route = value },
      selected: () => Reflect.get(target, 'config').searchProvider.get() as string | undefined }
  }

  it('temporarily selects a volatile route without mutating its readonly reference or fetch route', () => {
    const f = volatileHost()
    const restore = selectOpenAICodexSearchRoute(f.web, 'openai-codex')
    expect(f.selected()).toBe('openai-codex')
    expect(f.reference.get()).toBe('fixture-original')
    expect(f.target.config.fetchProvider.get()).toBe('fixture-fetch')
    restore(); restore()
    expect(f.target.config).toBe(f.config)
    expect(f.selected()).toBe('fixture-original')
  })

  it('yields to a later live Host selection and retains it after disposal', () => {
    const f = volatileHost()
    const restore = selectOpenAICodexSearchRoute(f.web, 'openai-codex')
    f.change('fixture-newer')
    expect(f.selected()).toBe('fixture-newer')
    restore()
    expect(f.target.config).toBe(f.config)
    expect(f.selected()).toBe('fixture-newer')
  })

  it('preserves another owner replacing the config object', () => {
    const f = volatileHost()
    const restore = selectOpenAICodexSearchRoute(f.web, 'openai-codex')
    const next = { searchProvider: Object.freeze({ get: () => 'other-owner' }) }
    Reflect.set(f.target, 'config', next)
    restore()
    expect(f.target.config).toBe(next)
  })

  it('rejects frozen or malformed config before changing the runtime', () => {
    const f = volatileHost()
    Object.freeze(f.config)
    expect(() => selectOpenAICodexSearchRoute(f.web, 'openai-codex')).toThrow()
    expect(f.target.config).toBe(f.config)
    const config = { searchProvider: { get: () => 42 } }
    const target = { config }
    expect(() => selectOpenAICodexSearchRoute(target as unknown as WebRuntime, 'openai-codex')).toThrow()
    expect(target.config).toBe(config)
  })

})
