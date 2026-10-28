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
import Llm, { LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projection from '@deepseek-ai/dsh-session-projection'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
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

async function fixture({ script, cua, officialCua = false, strict = false, taskApproval = true, humanAnswer, nativeResponse, config = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codex-cua-host-'))
  owned.push(() => rm(directory, { recursive: true, force: true }))
  const ctx = new Context()
  owned.push(() => ctx.fiber.dispose())
  const scopeFiber = strict && !officialCua ? await ctx.plugin({ apply(scopeCtx) {
    scopeCtx.provide('cuaWindowScope', Object.freeze({ version: 1, strictWindowScope: true }))
  } }) : undefined
  ctx.baseUrl = new URL(`file://${directory}/`).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  for (const service of [Llm, Sessions, Projection, AgentRegistry, Prompt, Tools]) await ctx.plugin(service)
  const questions = [], grants = [], nativeRequests = []
  if (!officialCua && taskApproval) ctx.provide('cuaTaskApproval', Object.freeze({ version: 1, begin(input) {
    assert.equal(ctx.agents.get(input.parent.id), input.parent)
    assert.equal(ctx.agents.get(input.child.id), input.child)
    assert.equal(ctx.agents.isOwnedBy(input.child.id, input.parent), true)
    const controller = new AbortController(), grant = { ...input, disposed: false }
    grants.push(grant)
    return { id: `synthetic-${grants.length}`, signal: controller.signal, async dispose() { grant.disposed = true }, async revoke() { controller.abort() } }
  } }))
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
      if (options.model === 'fixture-unrelated') {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'unrelated request completed' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
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
    await ctx.plugin(UserQuestions)
    ctx.on('user-questions/request', async (request, next) => { questions.push(request); return humanAnswer ? humanAnswer(request) : next() })
    await ctx.plugin(ComputerUse)
    await ctx.plugin({ inject: ['computerUse', 'agents', 'tools', 'systemPrompt'], apply(cuaCtx) {
      installCua(cuaCtx, CuaConfig({ agentPreset: PRESET, strictWindowScope: strict }), { helperPath: '/synthetic/no-executable', guidance: 'Synthetic channel', description: 'Fixture official CUA provider',
      createChannel() {
        const stdout = new PassThrough()
        let done
        const closed = new Promise(resolve => { done = resolve })
        const stdin = new Writable({ write(chunk, _encoding, callback) {
          const request = JSON.parse(chunk.toString())
          nativeRequests.push(request)
          Promise.resolve(nativeResponse ? nativeResponse(request) : request.method === 'getApp' ? { appHandle: 'app-fixture', pid: 1234, name: target.application,
            authorization: { id: 'a'.repeat(64), name: target.application, persistable: false } } : request.method === 'getState' ? {
              appHandle: 'app-fixture', pid: 1234, windowId: 7, snapshotId: 'strict-fixture', windowScope: 'strict-window', tree: 'Synthetic button', windows: [{ windowId: 7, pid: 1234, appName: target.application, title: 'Synthetic window', bounds: { x: 0, y: 0, width: 100, height: 100 }, isOnScreen: true, onCurrentSpace: true }], truncated: false,
            } : { acted: true }).then(result => { if (!stdout.writableEnded) stdout.write(JSON.stringify({ id: request.id, result }) + '\n') }, error => stdout.destroy(error))
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
        if (args.method === 'getState') return { windowId: 7, appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', ...(strict ? { windowScope: 'strict-window' } : {}) }
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
  return { ctx, parent, seen, dispatched, execute, controller, directory, scopeFiber, questions, grants, nativeRequests }
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

test('active worker hooks leave unrelated Host requests and agent steps unchanged', async () => {
  let ready, release
  const entered = new Promise(resolve => { ready = resolve })
  const resume = new Promise(resolve => { release = resolve })
  let worker
  const f = await fixture({ cua: async (args, exec) => {
    if (args.method === 'getApp') { worker = exec.agent; ready(); await resume; return { appHandle: 'app-fixture' } }
    return args.method === 'screenshot' ? { windowId: 7 } : { acted: true }
  } })
  const running = f.execute()
  await entered
  try {
    for (const context of [f.ctx, worker.ctx]) {
      const chunks = []
      for await (const chunk of context.llm.stream({ provider: ROUTE.provider, model: 'fixture-unrelated', sessionId: worker.id, messages: [], signal: new AbortController().signal })) chunks.push(chunk)
      assert.equal(chunks.at(-1).reason.kind, 'stop')
    }
    const answer = await worker.ctx.waterfall(f.parent.agent, 'agent/pre-step', {
      agent: f.parent.agent, modelSelection: { provider: 'deepseek', model: 'flash' }, signal: new AbortController().signal,
    }, async () => ({ kind: 'continue' }))
    assert.equal(answer.kind, 'continue')
  } finally { release() }
  const batch = await running
  assert.equal(batch.results[0].result.value.status, 'completed')
  assert.equal(f.dispatched.length, 4)
})

test('actual worker loop dispatch still rejects a changed route before the adapter', async () => {
  let ready, release, worker
  const entered = new Promise(resolve => { ready = resolve })
  const resume = new Promise(resolve => { release = resolve })
  const f = await fixture({ cua: async (_args, exec) => {
    worker = exec.agent; ready(); await resume; return { appHandle: 'app-fixture' }
  } })
  const running = f.execute()
  await entered
  try {
    await assert.rejects(async () => {
      for await (const _chunk of worker.ctx.llm.stream(markAgentLoopRequest({
        provider: ROUTE.provider, model: 'fixture-unrelated', reasoningEffort: ReasoningEffortId('high'),
        sessionId: worker.id, messages: [], signal: new AbortController().signal,
      }))) { /* consume the guarded dispatch */ }
    }, /CUA_WORKER_ROUTE_CHANGED/)
  } finally { release() }
  const batch = await running
  assert.equal(batch.results[0].result.value.reason, 'worker_route_changed')
  assert.equal(f.seen.length, 1)
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

test('a result refusal in a batch stops later input before transport', async () => {
  const f = await fixture({ script: [call('cua', { method: 'getApp', params: { selector: target.application } }), [
    call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }),
    call('cua', { method: 'click', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20 } }),
  ]], cua: async args => {
    if (args.method === 'getApp') return { appHandle: 'app-fixture' }
    throw new Error('APP_ACCESS_REVOKED: synthetic refusal')
  } })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.reason, 'application_access_revoked')
  assert.deepEqual(f.dispatched.map(row => row.args.method), ['getApp', 'screenshot'])
})

test('sequential batch input invalidates an earlier observation before finish', async () => {
  const f = await fixture({ script: [call('cua', { method: 'getApp', params: { selector: target.application } }), [
    call('cua', { method: 'screenshot', params: { appHandle: 'app-fixture', windowId: 7 } }),
    call('cua', { method: 'click', params: { appHandle: 'app-fixture', windowId: 7, x: 20, y: 20 } }),
    call('finish_computer_use', { status: 'completed', summary: 'unverified' }),
  ]] })
  const batch = await f.execute()
  assert.notEqual(batch.results[0].result.value.status, 'completed')
})

test('strict Host attestation admits form input and element clicks in a bounded sequential batch', async () => {
  const f = await fixture({ strict: true, script: [
    call('cua', { method: 'getApp', params: { selector: target.application } }),
    call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: false } }),
    [call('cua', { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 2, value: 'Synthetic Name' } }),
      call('cua', { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 3, value: 'Synthetic Code' } }),
      call('cua', { method: 'click', params: { appHandle: 'app-fixture', snapshotId: 'snapshot-fixture', elementIndex: 4 } }),
      call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: false } }),
      call('finish_computer_use', { status: 'completed', summary: 'Synthetic form observed' })],
  ] })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.status, 'completed')
  assert.equal(batch.results[0].result.value.modelSteps, 3)
  assert.deepEqual(f.dispatched.map(row => row.args.method), ['getApp', 'getState', 'setValue', 'setValue', 'click', 'getState'])
})

test('strict capability without matching native snapshot attestation is blocked', async () => {
  for (const value of [
    { appHandle: 'app-fixture', windowId: 7, snapshotId: 's' },
    { windowScope: 'strict-window', appHandle: 'foreign', windowId: 7, snapshotId: 's' },
    { windowScope: 'strict-window', appHandle: 'app-fixture', windowId: 8, snapshotId: 's' },
  ]) {
    const f = await fixture({ strict: true, script: [
      call('cua', { method: 'getApp', params: { selector: target.application } }),
      call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: false } }),
      call('cua', { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 's', elementIndex: 2, value: 'must not run' } }),
    ], cua: async args => args.method === 'getApp' ? { appHandle: 'app-fixture' } : value })
    const batch = await f.execute()
    assert.equal(batch.results[0].result.value.reason, 'host_window_scope_unverified')
    assert.equal(f.dispatched.length, 2)
  }
})

test('strict AX rejects menu requests and unobserved snapshot identities', () => {
  const scope = { strict: true, snapshotId: 'admitted' }
  assert.equal(operationDenial({ method: 'getState', params: { appHandle: 'a', windowId: 7, includeMenus: true } }, target, 'a', scope), 'CUA_MENU_INPUT_DENIED')
  assert.equal(operationDenial({ method: 'setValue', params: { appHandle: 'a', snapshotId: 'stolen', elementIndex: 1, value: 'x' } }, target, 'a', scope), 'CUA_SNAPSHOT_DENIED')
})

test('unloading the strict CUA provider invalidates the active worker capability', async () => {
  let f
  f = await fixture({ strict: true, cua: async args => {
    if (args.method === 'getApp') { await f.scopeFiber.dispose(); return { appHandle: 'app-fixture' } }
    throw new Error('must not reach transport')
  } })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.reason, 'cua_provider_changed')
  assert.equal(f.dispatched.length, 1)
})

test('a later strict observation supersedes the earlier snapshot before form input', async () => {
  let observations = 0
  const f = await fixture({ strict: true, script: [
    call('cua', { method: 'getApp', params: { selector: target.application } }),
    call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } }),
    call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } }),
    call('cua', { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 'snapshot-1', elementIndex: 2, value: 'stale' } }),
  ], cua: async args => args.method === 'getApp' ? { appHandle: 'app-fixture' }
    : { appHandle: 'app-fixture', windowId: 7, windowScope: 'strict-window', snapshotId: `snapshot-${++observations}` } })
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.status, 'blocked')
  assert.equal(f.dispatched.length, 3)
})

test('a late Host router cannot dispatch the Terra worker to Reserve', async t => {
  const f = await fixture()
  if (f.ctx.agents.requestRoutingVersion !== 1) { t.skip('requires the distinct local async-route Host'); return }
  f.ctx.on('agent/route-request', async (_event, next) => ({ ...await next(), model: 'gpt-reserve' }))
  const batch = await f.execute()
  assert.equal(batch.results[0].result.value.reason, 'worker_route_changed')
  assert.equal(f.seen.length, 0)
  assert.equal(f.dispatched.length, 0)
  assert.deepEqual(f.parent.agent.model.current(), { provider: 'deepseek', model: 'flash' })
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
  assert.equal(batch.results[0].result.value.reason, 'host_task_approval_unavailable')
})

test('absence of the task approval capability blocks before any child model or desktop call', async () => {
  const f = await fixture({ taskApproval: false })
  const value = (await f.execute()).results[0].result.value
  assert.equal(value.reason, 'host_task_approval_unavailable')
  assert.equal(f.seen.length, 0)
  assert.equal(f.dispatched.length, 0)
})

const taskScript = () => [
  call('cua', { method: 'getApp', params: { selector: target.application } }),
  call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: false } }),
  call('cua', { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 'strict-fixture', elementIndex: 2, value: 'Synthetic value' } }),
  call('cua', { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: false } }),
  call('finish_computer_use', { status: 'completed', summary: 'Synthetic state observed' }),
]
const allowTask = () => ({ answers: [{ id: 'cua-task-access', selected: ['Allow this task'] }] })

async function directTaskFixture(t, options = {}) {
  const f = await fixture({ officialCua: true, strict: true, humanAnswer: allowTask, ...options })
  const capability = f.ctx.get('cuaTaskApproval')
  if (!capability) { t.skip('requires local.2 task capability'); return }
  const child = await f.ctx.agents.create({ sessionId: SessionId(crypto.randomUUID()), parentAgent: f.parent.agent,
    meta: { origin: 'subagent', parentSession: f.parent.agent.id, agentPreset: PRESET },
    agentOptions: ROUTE, async setup(childCtx) { await f.ctx.agentPresets.mount(childCtx, PRESET) },
  })
  const controller = new AbortController()
  const input = { parent: f.parent.agent, child: child.agent, application: target.application, windowId: 7, goal: 'Direct synthetic task', expiresAt: Date.now() + 1500, signal: controller.signal }
  const grant = capability.begin(input)
  owned.push(async () => { await grant.dispose(); await child.dispose() })
  const invoke = async args => (await f.ctx.tools.execute({ agent: child.agent, calls: [call('cua', args)], signal: controller.signal })).results[0].result
  return { ...f, capability, child, controller, input, grant, invoke }
}

// Two Host policies receive separate adapters over one synthetic profile domain.
// Each read returns a fresh snapshot; a cached permission object cannot pass.
function sharedPermissionDomain() {
  let state = { migrated: true, applications: {} }, stateTail = Promise.resolve(), writes = 0
  const appTails = new Map()
  const queue = (previous, signal, operation) => previous.catch(() => {}).then(() => { signal.throwIfAborted(); return operation() })
  return {
    get writes() { return writes },
    open() { return {
      persistent: false,
      withState(signal, operation) {
        const result = queue(stateTail, signal, () => operation({ state: structuredClone(state), async save(next) { writes++; state = structuredClone(next) } }))
        stateTail = result.catch(() => {})
        return result
      },
      withApplication(id, signal, operation) {
        const result = queue(appTails.get(id) ?? Promise.resolve(), signal, operation)
        appTails.set(id, result.catch(() => {}))
        return result
      },
      async drain() { await Promise.all([stateTail, ...appTails.values()]) },
    } },
  }
}

test('another Host sharing the profile can revoke an approved task before later native dispatch', async t => {
  const first = await directTaskFixture(t)
  if (!first) return
  const second = await fixture({ officialCua: true, strict: true })
  const domain = sharedPermissionDomain()
  first.ctx.get('cuaAccess').policy.options.store = domain.open()
  second.ctx.get('cuaAccess').policy.options.store = domain.open()
  assert.equal((await first.invoke({ method: 'getApp', params: { selector: target.application } })).isError, false)
  assert.equal(domain.writes, 0, 'task consent must not save an application grant')
  const before = first.nativeRequests.length
  await second.ctx.get('cuaAccess').revoke('a'.repeat(64))
  assert.equal(domain.writes, 1, 'only the explicit legacy revoke writes shared state')
  assert.equal((await first.invoke({ method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } })).isError, true)
  assert.equal(first.nativeRequests.length, before)
  assert.equal(first.grant.signal.aborted, true)
})

test('another Host revoking during the human question invalidates its late approval', async t => {
  let asked, answer
  const pending = new Promise(resolve => { asked = resolve })
  const first = await directTaskFixture(t, { humanAnswer: () => { asked(); return new Promise(resolve => { answer = resolve }) } })
  if (!first) return
  const second = await fixture({ officialCua: true, strict: true })
  const domain = sharedPermissionDomain()
  first.ctx.get('cuaAccess').policy.options.store = domain.open()
  second.ctx.get('cuaAccess').policy.options.store = domain.open()
  const run = first.invoke({ method: 'getApp', params: { selector: target.application } })
  await pending
  await second.ctx.get('cuaAccess').revoke('a'.repeat(64))
  answer(allowTask())
  assert.equal((await run).isError, true)
  assert.deepEqual(first.nativeRequests.map(x => x.method), ['getApp'])
  assert.equal(first.grant.signal.aborted, true)
})

test('task registration rejects forged root, foreign child, extra fields and invalid lifetimes', async t => {
  const f = await directTaskFixture(t)
  if (!f) return
  const foreign = await f.ctx.agents.create({ sessionId: SessionId(crypto.randomUUID()), agentOptions: ROUTE })
  owned.push(() => foreign.dispose())
  for (const input of [
    { ...f.input, parent: { ...f.parent.agent } }, { ...f.input, child: foreign.agent },
    { ...f.input, expiresAt: Date.now() - 1 }, { ...f.input, expiresAt: Date.now() + 1800000 },
    { ...f.input, approved: true },
  ]) assert.throws(() => f.capability.begin(input), /task|Task|root/)
  assert.equal(f.nativeRequests.length, 0)
  assert.equal(f.questions.length, 0)
})

test('Host task scope rejects foreign windows, handles, snapshots and app-wide methods before dispatch', async t => {
  const f = await directTaskFixture(t)
  if (!f) return
  assert.equal((await f.invoke({ method: 'getApp', params: { selector: target.application } })).isError, false)
  assert.equal((await f.invoke({ method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } })).isError, false)
  const before = f.nativeRequests.length
  for (const args of [
    { method: 'getState', params: { appHandle: 'app-fixture', windowId: 8 } },
    { method: 'getState', params: { appHandle: 'app-fixture', windowId: 7, includeMenus: true } },
    { method: 'getState', params: { appHandle: 'foreign', windowId: 7 } },
    { method: 'setValue', params: { appHandle: 'app-fixture', snapshotId: 'foreign', elementIndex: 2, value: 'forbidden' } },
    { method: 'click', params: { appHandle: 'app-fixture', snapshotId: 'strict-fixture', elementIndex: 2, mouseButton: 'right' } },
    { method: 'typeText', params: { appHandle: 'app-fixture', text: 'forbidden' } },
  ]) assert.equal((await f.invoke(args)).isError, true)
  assert.equal(f.nativeRequests.length, before)
  assert.equal(f.questions.length, 1)
})

test('task closure leaves a tombstone so a live child cannot fall back to saved app consent', async t => {
  const f = await directTaskFixture(t)
  if (!f) return
  await f.invoke({ method: 'getApp', params: { selector: target.application } })
  await f.grant.dispose()
  assert.equal(f.grant.signal.aborted, true)
  const before = f.nativeRequests.length
  const result = await f.invoke({ method: 'getApp', params: { selector: target.application } })
  assert.equal(result.isError, true)
  assert.equal(f.nativeRequests.length, before)
  assert.throws(() => f.capability.begin(f.input), /already/)
})

test('revocation cancels in-flight native work and rejects later dispatch', async t => {
  let entered
  const pending = new Promise(resolve => { entered = resolve })
  const f = await directTaskFixture(t, { nativeResponse: request => {
    if (request.method === 'getApp') return { appHandle: 'app-fixture', pid: 1234, name: target.application, authorization: { id: 'a'.repeat(64), name: target.application, persistable: false } }
    if (request.method === 'getState') { entered(); return new Promise(() => {}) }
    return { acted: true }
  } })
  if (!f) return
  await f.invoke({ method: 'getApp', params: { selector: target.application } })
  const inFlight = f.invoke({ method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } })
  await pending
  await f.grant.revoke()
  assert.equal((await inFlight).isError, true)
  const before = f.nativeRequests.length
  assert.equal((await f.invoke({ method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } })).isError, true)
  assert.equal(f.nativeRequests.length, before)
})

test('revocation also drains the first native identity lookup before any question', async t => {
  let entered
  const pending = new Promise(resolve => { entered = resolve })
  const f = await directTaskFixture(t, { nativeResponse: request => {
    if (request.method === 'getApp') { entered(); return new Promise(() => {}) }
    return { acted: true }
  } })
  if (!f) return
  const run = f.invoke({ method: 'getApp', params: { selector: target.application } })
  await pending
  await f.grant.revoke()
  assert.equal((await run).isError, true)
  assert.equal(f.questions.length, 0)
  assert.equal(f.ctx.get('cuaAccess').policy.tasks.size, 0)
})

test('expiry while the root question is pending admits no observation or input', async t => {
  const f = await directTaskFixture(t, { humanAnswer: request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error('synthetic pending answer cancelled')), { once: true })
  }) })
  if (!f) return
  const result = await f.invoke({ method: 'getApp', params: { selector: target.application } })
  assert.equal(result.isError, true)
  assert.equal(f.grant.signal.aborted, true)
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
})

test('existing application revoke also revokes the task and requires fresh user input', async t => {
  const f = await directTaskFixture(t)
  if (!f) return
  await f.invoke({ method: 'getApp', params: { selector: target.application } })
  await f.ctx.get('cuaAccess').revoke('a'.repeat(64))
  assert.equal(f.grant.signal.aborted, true)
  assert.throws(() => f.capability.begin(f.input), /new user input/)
  const count = f.nativeRequests.length
  assert.equal((await f.invoke({ method: 'getState', params: { appHandle: 'app-fixture', windowId: 7 } })).isError, true)
  assert.equal(f.nativeRequests.length, count)
})

test('root Stop while the task question is pending cancels and drains without input', async t => {
  let asked
  const pending = new Promise(resolve => { asked = resolve })
  const f = await fixture({ officialCua: true, strict: true, script: taskScript(), humanAnswer: request => {
    asked()
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('synthetic human wait cancelled')), { once: true }))
  } })
  if (!f.ctx.get('cuaTaskApproval')) { t.skip('requires local.2 task capability'); return }
  const run = f.execute()
  await pending
  f.controller.abort()
  const result = (await run).results[0].result
  if (result.value) {
    assert.equal(result.value.status, 'cancelled')
    assert.equal(result.value.cleanup, 'drained')
  } else {
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.error), /ABORTED|AbortError/u)
  }
  const tasks = [...f.ctx.get('cuaAccess').policy.tasks.values()]
  for (const task of tasks) assert.equal(task.closed, true)
  await Promise.all(tasks.map(task => task.closing))
  assert.equal(f.ctx.get('cuaAccess').policy.tasks.size, 0)
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
})

test('a late human answer after revocation cannot reopen a task', async t => {
  let asked, answer
  const pending = new Promise(resolve => { asked = resolve })
  const f = await directTaskFixture(t, { humanAnswer: () => { asked(); return new Promise(resolve => { answer = resolve }) } })
  if (!f) return
  const run = f.invoke({ method: 'getApp', params: { selector: target.application } })
  await pending
  const revoke = f.grant.revoke()
  answer(allowTask())
  assert.equal((await run).isError, true)
  await revoke
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
})

test('application revoke during a pending task question invalidates the late answer', async t => {
  let asked, answer
  const pending = new Promise(resolve => { asked = resolve })
  const f = await directTaskFixture(t, { humanAnswer: () => { asked(); return new Promise(resolve => { answer = resolve }) } })
  if (!f) return
  const run = f.invoke({ method: 'getApp', params: { selector: target.application } })
  await pending
  const revoke = f.ctx.get('cuaAccess').revoke('a'.repeat(64))
  await new Promise(resolve => setImmediate(resolve))
  const revokedBeforeAnswer = f.grant.signal.aborted
  answer(allowTask())
  await run
  await revoke
  assert.equal(revokedBeforeAnswer, true)
  assert.throws(() => f.capability.begin(f.input), /new user input/)
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
})

test('a denied root task cannot automatically create another worker for the same user input', async t => {
  const f = await fixture({ officialCua: true, strict: true, script: taskScript(), humanAnswer: () => ({ answers: [{ id: 'cua-task-access', selected: ['Deny'] }] }) })
  if (!f.ctx.get('cuaTaskApproval')) { t.skip('requires local.2 task capability'); return }
  await f.execute()
  const count = f.seen.length
  const result = (await f.execute()).results[0].result.value
  assert.equal(result.reason, 'task_retry_requires_new_user_input')
  assert.equal(f.seen.length, count)
  assert.equal(f.questions.length, 1)
})

test('a dismissed or failed human question requires new user input before another worker', async t => {
  const f = await fixture({ officialCua: true, strict: true, script: taskScript(), humanAnswer: () => { throw new Error('synthetic human dialog dismissed') } })
  if (!f.ctx.get('cuaTaskApproval')) { t.skip('requires local.2 task capability'); return }
  await f.execute()
  const count = f.seen.length
  const result = (await f.execute()).results[0].result.value
  assert.equal(result.reason, 'task_retry_requires_new_user_input')
  assert.equal(f.seen.length, count)
  assert.equal(f.questions.length, 1)
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
})

test('official task approval asks the true root for one child/window with no permanent option', async t => {
  let f
  f = await fixture({ officialCua: true, strict: true, script: taskScript(), humanAnswer: request => {
    assert.equal(request.agent, f.parent.agent)
    assert.equal(f.nativeRequests.length, 1, 'only application identity lookup may precede approval')
    const q = request.questions[0]
    assert.equal(q.id, 'cua-task-access')
    assert.deepEqual(q.options.map(x => x.label), ['Allow this task', 'Deny'])
    assert.equal(q.intent.always, undefined)
    for (const text of ['Process: 1234', 'Window: 7', 'Complete the synthetic UI task', 'Expires:', 'Stop']) assert.ok(q.detail.includes(text))
    return allowTask()
  } })
  if (!f.ctx.get('cuaTaskApproval')) { t.skip('requires local.2 task capability'); return }
  const store = f.ctx.get('cuaAccess').policy.options.store
  const withState = store.withState.bind(store)
  store.withState = (signal, read) => withState(signal, ({ state }) => read({ state, save() { throw new Error('task consent must not write application grants') } }))
  const result = (await f.execute()).results[0].result.value
  assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(result.cleanup, 'drained')
  assert.equal(f.questions.length, 1)
  assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp', 'getState', 'setValue', 'getState'])
  assert.deepEqual(f.parent.agent.model.current(), { provider: 'deepseek', model: 'flash' })
  assert.deepEqual(store.memory.applications, {})
})

test('denied and malformed task answers never dispatch observation or input', async t => {
  for (const answer of [
    undefined, null, { answers: 'malformed' },
    { answers: [{ id: 'cua-task-access', selected: ['Allow this task'], custom: 7 }] },
    { answers: [{ id: 'cua-task-access', selected: ['Deny'] }] },
    { answers: [{ id: 'cua-task-access', selected: ['Always allow'] }] },
    { answers: [{ id: 'cua-task-access', selected: ['Allow this task'], custom: 'override' }] },
    { answers: [{ id: 'other', selected: ['Allow this task'] }] },
  ]) {
    const f = await fixture({ officialCua: true, strict: true, script: taskScript(), humanAnswer: () => answer })
    if (!f.ctx.get('cuaTaskApproval')) { t.skip('requires local.2 task capability'); return }
    const value = (await f.execute()).results[0].result.value
    assert.equal(value.status, 'blocked')
    assert.equal(value.cleanup, 'drained')
    assert.deepEqual(f.nativeRequests.map(x => x.method), ['getApp'])
    assert.equal(f.questions.length, 1)
    const before = f.seen.length
    assert.equal((await f.execute()).results[0].result.value.reason, 'task_retry_requires_new_user_input')
    assert.equal(f.seen.length, before)
  }
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
