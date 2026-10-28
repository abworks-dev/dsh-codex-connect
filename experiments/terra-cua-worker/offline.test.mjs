import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { tasks, initialState, transition, verify } from './fixture-state.mjs';
import { MockHost, MockLease, runMockTask, pilotPlan, createLiveHost } from './worker.mjs';
import { compare, validateRecord } from './compare.mjs';
import { buildFixture } from './build-fixture.mjs';

const parent = Object.freeze({ id: 'fixture-parent', route: Object.freeze({ provider: 'synthetic-deepseek', model: 'flash' }) });
const run = (taskId, options = {}) => runMockTask({ parent, taskId,
  host: new MockHost(taskId, { authorized: true }), lease: new MockLease(), plan: pilotPlan(taskId), ...options });

test('five objectives pass through an owned Terra mock while parent stays Flash', async () => {
  for (const task of tasks) {
    const result = await run(task.id);
    assert.equal(result.status, 'completed'); assert.equal(result.success, true);
    assert.equal(result.parentRoute.model, 'flash'); assert.equal(result.workerRoute.model, 'gpt-6.1-terra');
    assert.equal(result.usage.modelCalls, 0); assert.equal(result.evidence, 'synthetic');
  }
});
test('authorization defaults to blocked before a child or operation exists', async () => {
  const host = new MockHost('locate'), lease = new MockLease();
  const result = await run('locate', { host, lease });
  assert.equal(result.status, 'blocked'); assert.equal(result.code, 'AUTHORIZATION_MISSING');
  assert.equal(result.workerRoute, null); assert.equal(lease.busy, false);
  assert.deepEqual(host.events, ['cancel', 'disposed']);
});
test('strict method and argument guard rejects shell, extra authority and malformed values', async () => {
  for (const operation of [{ method: 'run_code', params: {} }, { method: 'click', params: { target: 'Cobalt', app: 'outside' } },
    { method: 'setValue', params: { target: 'Name', value: 42 } }, { method: 'scroll', params: { target: 'outside', direction: 'down' } }]) {
    const host = new MockHost('locate', { authorized: true });
    const result = await run('locate', { host, plan: async ({ call }) => { await call(operation); } });
    assert.equal(result.status, 'failed'); assert.equal(result.success, false);
    assert.deepEqual(host.events, ['child-created', 'cancel', 'disposed']);
  }
  assert.throws(createLiveHost, /LIVE_DRIVER_NOT_IMPLEMENTED/);
});
test('revocation between operations is enforced at dispatch', async () => {
  const host = new MockHost('locate', { authorized: true });
  const result = await run('locate', { host, plan: async ({ call }) => {
    await call({ method: 'getState', params: {} }); host.revoke();
    await call({ method: 'click', params: { target: 'Cobalt' } });
  } });
  assert.equal(result.status, 'blocked'); assert.equal(host.events.includes('click'), false);
});
test('a planner cannot catch a denied operation and then report a successful task', async () => {
  const result = await run('locate', { plan: async ({ call }) => {
    await call({ method: 'run_code', params: {} }).catch(() => {});
    await call({ method: 'click', params: { target: 'Cobalt' } }).catch(() => {});
  } });
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'OPERATION_DENIED');
});
test('cancellation drains a started call before releasing the lease', async () => {
  const host = new MockHost('locate', { authorized: true, delayMs: 35 }), lease = new MockLease();
  const controller = new AbortController();
  const pending = run('locate', { host, lease, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  assert.equal(lease.busy, true);
  const competing = await run('locate', { lease });
  assert.equal(competing.code, 'DESKTOP_BUSY');
  const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.success, false);
  assert.equal(host.events.includes('getState'), false); assert.equal(lease.busy, false);
  assert.equal(host.events.at(-1), 'disposed');
});
test('an already aborted task never creates a child', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await run('locate', { signal: controller.signal });
  assert.equal(result.status, 'cancelled'); assert.equal(result.workerRoute, null);
});
test('a planner that never returns still times out and closes its operation binding', async () => {
  let retainedCall;
  const lease = new MockLease();
  const result = await run('locate', { lease, timeoutMs: 10,
    plan: async ({ call }) => { retainedCall = call; await new Promise(() => {}); } });
  assert.equal(result.status, 'timed_out'); assert.equal(lease.busy, false);
  await assert.rejects(retainedCall({ method: 'click', params: { target: 'Cobalt' } }));
});
test('unconfirmed cleanup retains the lease and reports uncertainty', async () => {
  class UncertainHost extends MockHost { async dispose() { await super.dispose(); throw new Error('cleanup'); } }
  const lease = new MockLease();
  const result = await run('locate', { host: new UncertainHost('locate', { authorized: true }), lease });
  assert.equal(result.status, 'uncertain'); assert.equal(result.success, false); assert.equal(lease.busy, true);
});
test('wrong action, hidden list target and premature confirm cannot pass an objective', () => {
  const click = target => ({ method: 'click', params: { target } });
  let state = initialState('locate'); state = transition(state, click('Amber')); state = transition(state, click('Cobalt'));
  assert.equal(verify(state), false); assert.equal(state.wrongActions, 1);
  assert.equal(transition(initialState('scroll'), click('Item 24')).wrongActions, 1);
  assert.equal(transition(initialState('steps'), click('Confirm review')).wrongActions, 1);
});

// Fabricated records exercise the reporter only. They are never saved or called live evidence.
function record(taskId, arm, repeat = 1) {
  return { schemaVersion: 1, evidence: 'live', arm, taskId, pairId: `${taskId}-${repeat}`, repeat,
    status: 'completed', success: true, wrongActions: 0, humanInterventions: 0, elapsedMs: 100,
    usage: { modelCalls: 2, inputTokens: 20, outputTokens: 10,
      visibleCost: { amount: 1, currency: 'synthetic-units', scope: 'whole-task', source: 'synthetic-test' } },
    environment: { hardware: 'fixture-machine', os: 'fixture-os', applicationVersion: 'fixture-app', toolRuntimeVersion: 'fixture-tool',
      model: 'gpt-6.1-terra', effort: 'medium', serviceTier: 'standard', fixtureHash: 'fixture', initialStateHash: taskId,
      screen: { width: 1280, height: 800, dpr: 1, zoom: 1 } } };
}
function records(count = 5, repeats = 1) {
  return Array.from({ length: count }, (_, task) => Array.from({ length: repeats }, (_, index) =>
    ['native_desktop', 'customized_live'].map(arm => record(`task-${task}`, arm, index + 1)))).flat(2);
}
test('reporter rejects mock/API substitution, unknown metadata, missing cost and mismatched scales', () => {
  for (const alter of [row => { row.evidence = 'synthetic'; }, row => { row.arm = 'api_demo'; },
    row => { row.environment.model = null; }, row => { row.usage.visibleCost = null; },
    row => { row.environment.screen.dpr = 2; }]) {
    const rows = records(); alter(rows[1]); assert.equal(compare(rows).decision, 'not_comparable');
  }
  const rows = records(); rows[1].environment.effort = 'high'; assert.equal(compare(rows).reason, 'MISMATCH_effort');
  assert.throws(() => validateRecord({ ...rows[0], elapsedMs: NaN }), /INVALID_TRIAL/);
});
test('pilot cannot establish equivalence, and repetitions cannot manufacture distinct coverage', () => {
  assert.equal(compare(records()).decision, 'pilot_only');
  assert.equal(compare(records(5, 20)).decision, 'pilot_only');
  const full = compare(records(30, 3));
  assert.equal(full.distinctTasks, 30); assert.equal(full.thresholds.approved, false);
  assert.equal(full.decision, 'discussion_gate_met_requires_review');
});
test('reporter stops on regressions, wrong actions and unpaired or duplicate trials', () => {
  const rows = records(); rows[1].elapsedMs = 150;
  rows.filter(row => row.arm === 'customized_live').forEach(row => { row.elapsedMs = 150; });
  assert.equal(compare(rows).decision, 'pause_productization');
  const wrong = records(); wrong[1].wrongActions = 1; assert.equal(compare(wrong).decision, 'pause_productization');
  assert.equal(compare(records().slice(1)).reason, 'UNPAIRED_TRIAL');
  assert.equal(compare([...records(), records()[0]]).reason, 'DUPLICATE_ARM');
  const drift = records(); drift.slice(2, 4).forEach(row => { row.environment.screen.width = 1440; });
  assert.equal(compare(drift).reason, 'BASELINE_CHANGED');
  const unusable = records(); unusable.forEach(row => { row.success = false; row.status = 'failed'; });
  assert.equal(compare(unusable).reason, 'UNUSABLE_NATIVE_BASELINE');
});
test('standalone page builds without external resources and its JavaScript parses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terra-cua-fixture-'));
  try {
    const url = pathToFileURL(join(directory, 'fixture.html')); await buildFixture(url);
    const page = await readFile(url, 'utf8');
    assert.equal(page.includes('/* STATE_ENGINE */'), false);
    assert.equal(/<(?:script|link|iframe)[^>]+(?:src|href)=/i.test(page), false);
    assert.match(page, /connect-src 'none'/); new Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
