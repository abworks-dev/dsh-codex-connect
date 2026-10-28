/** Real published Host loop and Native pipeline, scripted in-memory provider/CUA. No network or GUI. */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough, Writable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Llm, { LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projection from '@deepseek-ai/dsh-session-projection'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import { CuaConfig, installCua } from '@deepseek-ai/dsh-cua'
import { computerUseTool, operationDenial, PRESET, TOOL, ROUTE } from '../worker.mjs'
import { acquireDesktopLease } from '../lease.mjs'

const owned = []
afterEach(async () => { for (const item of owned.splice(0).reverse()) await item() })
const target = { application: 'Synthetic Browser', windowId: 7, maxDurationMs: 2000, maxSteps: 12, maxOperations: 20 }
const schema = { type: 'object' }
const output = { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
function call(name, args) { return { type: 'tool-call', id: ToolCallId(`call-${crypto.randomUUID()}`), name, arguments: JSON.stringify(args) } }
function *toolStream(block) {
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'finish', reason: { kind: 'tool-call' } }
}

async function fixture({ script, cua, officialCua = false, config = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-cua-host-'))
  owned.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  owned.push(() => ctx.fiber.dispose())
  ctx.baseUrl = new URL(`file://${directory}/`).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  for (const service of [Llm, Sessions, Projection, AgentRegistry, Prompt, Tools]) await ctx.plugin(service)
  await ctx.plugin(Presets, { default: PRESET })
  await ctx.agentPresets.register({ id: PRESET, plugins: [] })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.setExecutor(new NativeToolExecutor(ctx))
  const seen = [], dispatched = []
  let index = 0
  class Scripted extends LlmAdapter {
    providerInfo(id) { return { id, name: 'In-memory fixture' } }
    async listModels(provider) { return [{ provider, id: ROUTE.model, name: 'Fixture' }] }
    async resolveModel(provider, id) { return { provider, id, name: 'Fixture', reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'high' }] } } }
    async *stream(options) {
      seen.push(options)
      const blocks = script ?? [call('cua', { method: 'getApp', params: { selector: target.application } }),
        call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }),
        call('cua', { method: 'click', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20 } }),
        call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }),
        call('finish_computer_use', { status: 'completed', summary: 'Synthetic success observed' })]
      const block = blocks[index++]
      if (Array.isArray(block)) {
        for (const [i, item] of block.entries()) {
          yield { type: 'block-start', index: i, blockType: 'tool-call' }
          yield { type: 'block-end', index: i, block: item }
        }
        yield { type: 'finish', reason: { kind: 'tool-call' } }
      } else if (block) yield *toolStream(block)
      else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.llm.registerAdapter(['openai-codex'], new Scripted())
  ctx.tools.register({ name: 'host_shell', description: 'Forbidden capability', parameters: schema, output, async execute() { throw new Error('shell reached') } })
  // Match the official CUA provider's scoped registration lifecycle without launching its helper.
  if (officialCua) {
    await ctx.plugin(ComputerUse)
    await ctx.plugin({ inject: ['computerUse', 'agents', 'tools', 'systemPrompt'], apply(cuaCtx) {
      installCua(cuaCtx, CuaConfig({ agentPreset: PRESET }), { helperPath: '/synthetic/no-executable', guidance: 'Synthetic channel', description: 'Fixture official CUA provider',
      createChannel() {
        const stdout = new PassThrough()
        let done
        const closed = new Promise(resolve => { done = resolve })
        const stdin = new Writable({ write(chunk, _encoding, callback) {
          const request = JSON.parse(chunk.toString())
          assert.equal(request.method, 'getApp')
          stdout.write(JSON.stringify({ id: request.id, result: { appHandle: 'app-fixture', pid: 1234, name: target.application,
            authorization: { id: 'a'.repeat(64), name: target.application, persistable: false } } }) + '\n')
          callback()
        } })
        return { stdin, stdout, done: closed, close() { stdout.end(); stdin.end(); done() }, waitForClose: () => closed }
      },
      })
    } })
  } else ctx.on('agent/created', ({ agent }) => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== PRESET) return
    agent.ctx.tools.register({ name: 'cua', description: 'Synthetic transport only', parameters: schema, output,
      async execute(args, exec) {
        dispatched.push({ args, agent: exec.agent })
        if (cua) return cua(args, exec)
        if (args.method === 'getApp') return { appHandle: 'app-fixture' }
        if (args.method === 'getState') return { windowId: 7, snapshotId: 'snapshot-fixture' }
        if (args.method === 'screenshot') return { windowId: 7 }
        return { acted: true }
      },
    })
  })
  const parent = await ctx.agents.create({ sessionId: SessionId(`parent-${crypto.randomUUID()}`), agentOptions: { provider: 'deepseek', model: 'flash' } })
  owned.push(() => parent.dispose())
  const tool = computerUseTool(ctx, { ...target, ...config }, () => acquireDesktopLease(directory))
  ctx.tools.register(tool)
  const controller = new AbortController()
  const execute = () => ctx.tools.execute({ agent: parent.agent, calls: [call(TOOL, { goal: 'Complete the synthetic UI task' })], signal: controller.signal })
  return { ctx, parent, seen, dispatched, execute, controller, directory }
}

test('independent Terra child uses the real Native pipeline and leaves the Flash parent route unchanged', async () => {
  const f = await fixture()
  const batch = await f.execute()
  assert.equal(batch.results[0].result.isError, false)
  const value = batch.results[0].result.value
  assert.equal(value.status, 'completed')
  assert.equal(value.cleanup, 'drained')
  assert.equal(value.modelSteps, 5)
  assert.equal(f.dispatched.length, 4)
  assert.ok(f.dispatched.every(call => call.agent.id === value.workerSessionId && call.agent !== f.parent.agent))
  assert.equal(f.ctx.agents.get(value.workerSessionId), undefined)
  assert.deepEqual(f.parent.agent.model.current(), { provider: 'deepseek', model: 'flash' })
  assert.equal(value.effectiveModel.model, ROUTE.model)
  assert.equal(value.acceptance, 'not_independently_verified')
})

test('an inherited shell and run_code cannot execute', async () => {
  for (const name of ['host_shell', 'run_code']) {
    const f = await fixture({ script: [call(name, { code: 'forbidden' })] })
    const batch = await f.execute()
    assert.notEqual(batch.results[0].result.value.status, 'completed')
    assert.equal(f.dispatched.length, 0)
  }
})

test('wrong applications/windows and unobserved AX snapshots are denied before transport', () => {
  assert.equal(operationDenial({ method: 'getApp', params: { selector: 'Personal App' } }, target), 'CUA_APPLICATION_DENIED')
  assert.equal(operationDenial({ method: 'screenshot', params: { appHandle: 'a', windowId: 99 } }, target, 'a'), 'CUA_WINDOW_DENIED')
  assert.equal(operationDenial({ method: 'setValue', params: { appHandle: 'a', snapshotId: 'stolen', elementIndex: 1 } }, target, 'a'), 'CUA_AX_WINDOW_OWNERSHIP_UNVERIFIED')
  assert.equal(operationDenial({ method: 'typeText', params: { appHandle: 'a', text: 'outside' } }, target, 'a'), 'CUA_OPERATION_DENIED')
  for (const variant of [{ mouseButton: 'right' }, { mouseButton: 'middle' }, { modifiers: ['control'] }, { modifiers: ['command'] }, { holdMs: 1000 }]) {
    assert.equal(operationDenial({ method: 'click', params: { appHandle: 'a', windowId: 7, x: 20, y: 20, ...variant } }, target, 'a'), 'CUA_MENU_INPUT_DENIED')
  }
})

test('a pre-input screenshot cannot support a completed result after input', async () => {
  const f = await fixture({ script: [
    call('cua', { method: 'getApp', params: { selector: target.application } }),
    call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }),
    call('cua', { method: 'click', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20 } }),
    call('finish_computer_use', { status: 'completed', summary: 'unverified' }),
  ] })
  const batch = await f.execute()
  assert.notEqual(batch.results[0].result.value.status, 'completed')
})

test('multi-call batches cannot race a refusal or observation update against later input', async () => {
  for (const grouped of [
    [call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }), call('cua', { method: 'click', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20 } })],
    [call('cua', { method: 'scroll', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20, deltaLinesY: 2, deltaLinesX: 0 } }), call('finish_computer_use', { status: 'completed', summary: 'unverified' })],
  ]) {
    const f = await fixture({ script: [call('cua', { method: 'getApp', params: { selector: target.application } }), grouped] })
    const batch = await f.execute()
    assert.equal(batch.results[0].result.value.status, 'blocked')
    assert.equal(batch.results[0].result.value.reason, 'single_call_required')
    assert.equal(f.dispatched.length, 1)
  }
})

test('a window-tagged snapshot cannot authorize application-menu or other AX elements', async () => {
  for (const params of [
    { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 0 },
    { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 9, windowId: 7 },
    { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 2, mouseButton: 'right' },
  ]) {
    const f = await fixture({ script: [call('cua', { method: 'getApp', params: { selector: target.application } }), call('cua', { method: 'click', params })] })
    const batch = await f.execute()
    assert.equal(batch.results[0].result.value.status, 'blocked')
    assert.equal(batch.results[0].result.value.reason, 'host_window_scope_unverified')
    assert.equal(f.dispatched.length, 1)
  }
  assert.equal(operationDenial({ method: 'getState', params: { appHandle: 'a', windowId: 7, includeMenus: false } }, target, 'a'), 'CUA_AX_WINDOW_OWNERSHIP_UNVERIFIED')
  assert.equal(operationDenial({ method: 'performSecondaryAction', params: { appHandle: 'a', elementIndex: 1, action: 'AXPress' } }, target, 'a'), 'CUA_AX_WINDOW_OWNERSHIP_UNVERIFIED')
})

test('delegated application approval absence is blocked with no fallback', async () => {
  const f = await fixture({ cua: async () => { throw new Error('APP_APPROVAL_UNAVAILABLE: delegated caller cannot ask') } })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.status, 'blocked')
  assert.equal(batch.results[0].result.value.reason, 'application_authorization_required')
  assert.equal(f.dispatched.length, 1)
})

test('official published CUA returns blocked when no delegated consent answerer exists', async () => {
  const f = await fixture({ officialCua: true })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.status, 'blocked')
  assert.equal(batch.results[0].result.value.reason, 'application_authorization_required')
})

test('a Host-reported in-flight revocation stops later actions', { timeout: 3000 }, async () => {
  let entered, revoke
  const waiting = new Promise(resolve => { entered = resolve })
  const f = await fixture({ cua: async args => {
    if (args.method === 'getApp') return { appHandle: 'app-fixture' }
    entered()
    return new Promise((_resolve, reject) => { revoke = () => reject(new Error('APP_ACCESS_REVOKED: synthetic Host revocation')) })
  } })
  const running = f.execute()
  await waiting
  revoke()
  const batch = await running
  assert.equal(batch.results[0].result.value.status, 'blocked')
  assert.equal(batch.results[0].result.value.reason, 'application_access_revoked')
  assert.equal(f.dispatched.length, 2)
})

test('caller cancellation drains in-flight transport before releasing the desktop lease', { timeout: 3000 }, async () => {
  let started, drained = false
  const entered = new Promise(resolve => { started = resolve })
  const f = await fixture({ cua: async (_args, exec) => {
    started()
    await new Promise(resolve => exec.signal.addEventListener('abort', resolve, { once: true }))
    await new Promise(resolve => setTimeout(resolve, 15))
    drained = true
    throw new Error('cancelled')
  } })
  const running = f.execute()
  await entered
  await assert.rejects(acquireDesktopLease(f.directory), { code: 'EEXIST' })
  f.controller.abort()
  await running
  assert.equal(drained, true)
  const next = await acquireDesktopLease(f.directory); next.release(true)
})

test('lease loss aborts an in-flight native operation and returns blocked', { timeout: 3000 }, async () => {
  let started, drained = false
  const entered = new Promise(resolve => { started = resolve })
  const f = await fixture({ cua: async (_args, exec) => {
    started()
    await new Promise(resolve => exec.signal.addEventListener('abort', resolve, { once: true }))
    drained = true
    throw new Error('cancelled')
  } })
  const running = f.execute()
  await entered
  await unlink(join(f.directory, 'desktop.lock'))
  const batch = await running
  assert.equal(drained, true)
  assert.equal(batch.results[0].result.value.reason, 'desktop_lease_lost')
})
