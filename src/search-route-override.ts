/** Runtime search-route adapter for the supported DeepSeek Harness release. */

import type WebRuntime from '@deepseek-ai/dsh-web'

const SEARCH_PROVIDER_FIELD = 'searchProviderId'

function readSearchProvider(web: WebRuntime): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(web, SEARCH_PROVIDER_FIELD)) {
    throw new Error('The installed DeepSeek Harness does not expose the supported search route field')
  }
  const value = Reflect.get(web, SEARCH_PROVIDER_FIELD) as unknown
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('The installed DeepSeek Harness returned an invalid search route')
  }
  return value
}

function writeSearchProvider(web: WebRuntime, provider: string | undefined): void {
  if (!Reflect.set(web, SEARCH_PROVIDER_FIELD, provider) || readSearchProvider(web) !== provider) {
    throw new Error('The installed DeepSeek Harness refused the search route change')
  }
}

/** rc.2 reads a Host-owned readonly Volatile reference on each search. */
function selectVolatileRoute(web: WebRuntime, provider: string): () => void {
  const slot = Object.getOwnPropertyDescriptor(web, 'config')
  const config: unknown = Reflect.get(web, 'config')
  if (slot?.writable !== true || !('value' in slot) || typeof config !== 'object' || config === null) {
    throw new Error('The installed DeepSeek Harness does not expose the supported search route field')
  }
  const field = Object.getOwnPropertyDescriptor(config, 'searchProvider')
  const reference: unknown = Reflect.get(config, 'searchProvider')
  if (field === undefined || !('value' in field) || !(field.configurable || field.writable)
    || typeof reference !== 'object' || reference === null || !('get' in reference) || typeof reference.get !== 'function') {
    throw new Error('The installed DeepSeek Harness does not expose the supported volatile search route')
  }
  const get = reference.get as () => unknown
  const read = (): string | undefined => {
    const value = get.call(reference)
    if (value !== undefined && typeof value !== 'string') throw new Error('The installed DeepSeek Harness returned an invalid search route')
    return value
  }
  const previous = read()
  // Do not write the Host's Volatile reference or persistent settings. Its owner
  // keeps updating the original reference; a newer choice takes precedence.
  const selected = Object.freeze({ get: () => {
    const current = read()
    return current === previous ? provider : current
  } })
  const facade = new Proxy(config, { get(target, key, receiver) {
    const current: unknown = Reflect.get(target, key, receiver)
    return key === 'searchProvider' && current === reference ? selected : current
  } })
  if (!Reflect.set(web, 'config', facade) || Reflect.get(web, 'config') !== facade) {
    throw new Error('The installed DeepSeek Harness refused the search route change')
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    if (Reflect.get(web, 'config') === facade && !Reflect.set(web, 'config', config)) {
      throw new Error('The installed DeepSeek Harness refused search route restoration')
    }
  }
}

/**
 * Select one provider in the supported DSH runtime and return an idempotent restore operation.
 * The restore preserves a newer third-party route change instead of overwriting it.
 * @param web - active DSH web runtime.
 * @param provider - registered provider id selected while the capability is enabled.
 * @returns disposer that restores the route observed before selection.
 */
export function selectOpenAICodexSearchRoute(web: WebRuntime, provider: string): () => void {
  if (!Object.prototype.hasOwnProperty.call(web, SEARCH_PROVIDER_FIELD)) return selectVolatileRoute(web, provider)
  const previous = readSearchProvider(web)
  writeSearchProvider(web, provider)
  let active = true
  return () => {
    if (!active) return
    active = false
    if (readSearchProvider(web) === provider) writeSearchProvider(web, previous)
  }
}
