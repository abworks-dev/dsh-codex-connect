/** Paired local trial reporting. Labels are operator assertions, not evidence attestation. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const discussionThresholds = Object.freeze({ approved: false, successLoss: 0.05, elapsedRatio: 1.2, visibleCostRatio: 1.2 });
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = value => typeof value === 'string' && value.length > 0;

export function validateRecord(record) {
  if (record.schemaVersion !== 1 || !['synthetic', 'live'].includes(record.evidence)
    || !['mock', 'native_desktop', 'customized_live', 'api_demo'].includes(record.arm)
    || !text(record.taskId) || !text(record.pairId) || !Number.isInteger(record.repeat) || record.repeat < 1
    || !['completed', 'blocked', 'cancelled', 'timed_out', 'failed', 'uncertain'].includes(record.status)
    || typeof record.success !== 'boolean' || (record.success && record.status !== 'completed')
    || !numeric(record.elapsedMs) || !Number.isInteger(record.wrongActions) || record.wrongActions < 0
    || !Number.isInteger(record.humanInterventions) || record.humanInterventions < 0) throw new Error('INVALID_TRIAL');
  const usage = record.usage;
  if (!usage || ['modelCalls', 'inputTokens', 'outputTokens'].some(key => usage[key] !== null
    && (!Number.isInteger(usage[key]) || usage[key] < 0))) throw new Error('INVALID_USAGE');
  if (usage.visibleCost !== null && (!numeric(usage.visibleCost?.amount)
    || !['currency', 'scope', 'source'].every(key => text(usage.visibleCost[key])))) throw new Error('INVALID_COST');
  const env = record.environment;
  if (!env || !env.screen || !['hardware', 'os', 'applicationVersion', 'toolRuntimeVersion', 'model', 'effort', 'serviceTier', 'fixtureHash', 'initialStateHash']
    .every(key => env[key] === null || text(env[key]))
    || !['width', 'height', 'dpr', 'zoom'].every(key => env.screen[key] === null || (numeric(env.screen[key]) && env.screen[key] > 0))) throw new Error('INVALID_ENVIRONMENT');
  return record;
}

/** Resample distinct tasks, keeping repeated trials together; not a proof of equivalence. */
function uncertainty(clusters) {
  let seed = 7319;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const samples = Array.from({ length: 2000 }, () => {
    const picked = clusters.map(() => clusters[Math.floor(random() * clusters.length)]);
    return [average(picked.map(row => row.loss)), median(picked.map(row => row.elapsed)), median(picked.map(row => row.cost))];
  });
  return Object.fromEntries(['successLoss', 'elapsedRatio', 'visibleCostRatio'].map((key, index) => {
    const values = samples.map(row => row[index]).sort((a, b) => a - b);
    return [key, [values[49], values[1949]]];
  }));
}

export function compare(records) {
  const stop = reason => ({ decision: 'not_comparable', reason, thresholds: discussionThresholds });
  if (!Array.isArray(records) || records.length === 0) return stop('NO_TRIALS');
  records.forEach(validateRecord);
  if (records.some(row => row.evidence !== 'live' || !['native_desktop', 'customized_live'].includes(row.arm))) return stop('NATIVE_LIVE_BASELINE_REQUIRED');
  const pairs = new Map();
  for (const row of records) {
    const pair = pairs.get(row.pairId) ?? {};
    if (pair[row.arm]) return stop('DUPLICATE_ARM');
    pair[row.arm] = row; pairs.set(row.pairId, pair);
  }
  const stable = new Map();
  const groups = new Map();
  let baselineSignature;
  for (const pair of pairs.values()) {
    const native = pair.native_desktop, custom = pair.customized_live;
    if (!native || !custom || native.taskId !== custom.taskId || native.repeat !== custom.repeat) return stop('UNPAIRED_TRIAL');
    if (groups.get(native.taskId)?.some(pair => pair[0].repeat === native.repeat)) return stop('DUPLICATE_TASK_REPEAT');
    for (const row of [native, custom]) {
      if (Object.values(row.environment).some(value => value === null)
        || Object.values(row.environment.screen).some(value => value === null)) return stop('UNKNOWN_BASELINE_METADATA');
      if (row.usage.modelCalls === null || row.usage.visibleCost === null) return stop('UNKNOWN_VISIBLE_USAGE');
      const { applicationVersion, toolRuntimeVersion } = row.environment;
      const version = JSON.stringify([applicationVersion, toolRuntimeVersion]);
      if (stable.has(row.arm) && stable.get(row.arm) !== version) return stop('VERSION_CHANGED');
      stable.set(row.arm, version);
    }
    for (const key of ['hardware', 'os', 'model', 'effort', 'serviceTier', 'screen', 'fixtureHash', 'initialStateHash']) {
      if (JSON.stringify(native.environment[key]) !== JSON.stringify(custom.environment[key])) return stop(`MISMATCH_${key}`);
    }
    if (native.environment.model !== 'gpt-6.1-terra') return stop('TERRA_BASELINE_REQUIRED');
    for (const key of ['currency', 'scope', 'source']) {
      if (native.usage.visibleCost[key] !== custom.usage.visibleCost[key]) return stop('INCOMMENSURATE_COST');
    }
    const signature = JSON.stringify([
      ...['hardware', 'os', 'model', 'effort', 'serviceTier', 'screen', 'fixtureHash'].map(key => native.environment[key]),
      ...['currency', 'scope', 'source'].map(key => native.usage.visibleCost[key]),
    ]);
    if (baselineSignature !== undefined && baselineSignature !== signature) return stop('BASELINE_CHANGED');
    baselineSignature = signature;
    if (native.elapsedMs === 0 || native.usage.visibleCost.amount === 0) return stop('ZERO_BASELINE_DENOMINATOR');
    groups.set(native.taskId, [...groups.get(native.taskId) ?? [], [native, custom]]);
  }
  const clusters = [...groups.values()].map(pairs => ({
    loss: average(pairs.map(([native, custom]) => Number(native.success) - Number(custom.success))),
    elapsed: median(pairs.map(([native, custom]) => custom.elapsedMs / native.elapsedMs)),
    cost: median(pairs.map(([native, custom]) => custom.usage.visibleCost.amount / native.usage.visibleCost.amount)),
  }));
  const estimates = { successLoss: average(clusters.map(row => row.loss)), elapsedRatio: median(clusters.map(row => row.elapsed)), visibleCostRatio: median(clusters.map(row => row.cost)) };
  const intervals95 = uncertainty(clusters);
  const metrics = Object.fromEntries(['native_desktop', 'customized_live'].map(arm => {
    const rows = records.filter(row => row.arm === arm), elapsed = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
    return [arm, { trials: rows.length, successes: rows.filter(row => row.success).length,
      wrongActions: rows.reduce((sum, row) => sum + row.wrongActions, 0),
      humanInterventions: rows.reduce((sum, row) => sum + row.humanInterventions, 0),
      medianElapsedMs: median(elapsed), p95ElapsedMs: elapsed[Math.ceil(elapsed.length * 0.95) - 1] }];
  }));
  if (metrics.native_desktop.successes === 0) return stop('UNUSABLE_NATIVE_BASELINE');
  const unsafe = records.some(row => row.wrongActions > 0 || row.humanInterventions > 0 || ['uncertain', 'blocked'].includes(row.status));
  const breached = Object.entries(estimates).some(([key, value]) => value > discussionThresholds[key]);
  const enough = groups.size >= 30 && [...groups.values()].every(pairs => pairs.length >= 3);
  const pilotClean = groups.size >= 5 && records.every(row => row.success);
  const inconclusive = Object.entries(intervals95).some(([key, bounds]) => bounds[1] > discussionThresholds[key]);
  const decision = unsafe || breached ? 'pause_productization' : !enough ? (pilotClean ? 'pilot_only' : 'insufficient_evidence')
    : inconclusive ? 'inconclusive' : 'discussion_gate_met_requires_review';
  return { decision, distinctTasks: groups.size, pairs: pairs.size, metrics, estimates, intervals95, thresholds: discussionThresholds,
    limitation: 'Operator-supplied live labels are not attested. Task-cluster percentile bootstrap; representative coverage and threshold approval still require review. Never declares equivalence.' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node compare.mjs trials.jsonl');
  const records = (await readFile(process.argv[2], 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  console.log(JSON.stringify(compare(records), null, 2));
}
