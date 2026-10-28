# Terra Computer Use: isolated offline experiment

**Mock-only. No real Computer Use acceptance or performance claim.** This directory is a bounded worker-protocol and local-trial preparation experiment. Nothing imports it from `src/`, the plugin patch or package exports. The npm `files` allowlist excludes this directory. It does not mount tools, launch applications, create native chats, load credentials, send model requests, install plugins or change a daily DSH profile. `createLiveHost()` always rejects.

## Authority and scope

Source baseline: Codex Connect `7fcc0dd9f9ef34daf4d199d663698e4ad62ae07e` (`0.2.0-alpha.11`). Read root `AGENTS.md`, `docs/maintenance-scope.md` and the relevant ownership sections of `docs/design.md`. This checkout has no `.agents/skills` directory. The user's bounded authorization covers this separate offline prototype and review preparation. It does not reopen Adaptive Task, retired orchestration, account/model switching, budget experiments or live acceptance. No existing Task code or release configuration is changed.

Deliverable: an owned Terra worker contract represented by a mocked Host, five resettable synthetic tasks, an operator result schema, a paired reporter and a local execution plan. A real Host adapter, cross-process desktop lock, delegated consent API, screenshots, coordinate routing and UI/model execution remain unimplemented. Do not connect this experiment to rc.3 through private APIs or by pretending its Host already has CUA.

## Run offline

Requires Node 22.19+ or 24+; no dependency installation, account or service is needed. From the repository root:

```sh
node --test experiments/terra-cua-worker/offline.test.mjs
node experiments/terra-cua-worker/build-fixture.mjs
mkdir -p experiments/terra-cua-worker/artifacts
node experiments/terra-cua-worker/pilot.mjs > experiments/terra-cua-worker/artifacts/mock.jsonl
node experiments/terra-cua-worker/compare.mjs experiments/terra-cua-worker/artifacts/mock.jsonl
```

The final command must return `not_comparable / NATIVE_LIVE_BASELINE_REQUIRED`. Mock elapsed time is local scripted delay, model calls are zero, and tokens/cost stay null. The generated `artifacts/fixture.html` is a standalone page for a later explicitly authorized local UI test. Building it does not open it. Artifacts are ignored; never commit private paths, device names, screenshots, account data or live conversation records.

## Worker protocol and real-adapter requirements

The future public task tool accepts a goal, allowed synthetic target and deadline; the Host obtains the actual parent identity from the tool execution context. A model-supplied parent ID, model route, application permission or lease token must not grant authority. The parent keeps its Flash route. The Host creates a fresh owned child, pins `openai-codex / gpt-6.1-terra`, and exposes only scoped native CUA operations and a bounded completion mechanism. It must suppress inherited PTC/shell/network/filesystem/delegation tools and guard actual execution, not merely hide schemas. The planner callback here is trusted synthetic test code, not a code sandbox or model session.

`worker.mjs` demonstrates this order:

1. Validate the request; reject missing application authorization before child creation or observation.
2. Acquire the shared mock lease; fail closed with `DESKTOP_BUSY` rather than build a background job platform.
3. Create an owned child with its own route; keep the parent route unchanged.
4. Validate exact method/argument fields, check authorization, task lifetime and lease at every dispatch.
5. On Stop/deadline, close admission and cancel; join dispatched work and dispose the child before releasing the lease. Cleanup uncertainty returns `uncertain` and retains ownership.
6. Return `completed`, `blocked`, `cancelled`, `timed_out`, `failed` or `uncertain`, with objective result, wrong actions, elapsed time, visible usage and intervention count.

The fixture operations (`getState`, `click`, `setValue`, `scroll`) use synthetic target labels. They are deliberately not a native CUA wire-compatible driver. A real adapter must use standard Host pipeline admission, app/window identity, snapshot freshness, screenshot projection through the **worker's** model route, coordinate validation and native cancellation acknowledgement. It must not call tool bodies directly to skip policy. Actions already dispatched cannot be undone or automatically replayed.

`MockLease` is a single-process immediate-exclusion fixture. Production needs a device-wide, cross-process lease with fencing checked by every participating desktop path, cancellation while waiting, crash reconciliation and release only after native cleanup. It cannot prevent the human from interacting; manual takeover must cancel the job. The current single-provider slot, per-connection busy flag and clipboard lock are not substitutes.

Owned children cannot ask User Questions for new app consent. A real adapter must return `blocked / needs approval` or use a future explicitly supported Host delegation-grant API. Parent session-only consent must not be copied to a child; creating a fake root is forbidden. Permissions and new live execution require a separate confirmation.

## Five-task pilot

The page and mock share `fixture-state.mjs`. `Reset current task` recreates initial state; changing the task also resets it. Nothing persists between page reloads. All names, codes and error messages are synthetic. The page has no external resources or requests and sets `connect-src 'none'` and `form-action 'none'`.

| Task | Prompt shown to both arms | Deterministic completion |
| --- | --- | --- |
| locate | Click Cobalt in the target grid. | Cobalt selected; no wrong actions |
| form | Enter Ada Test and LAB-204, then submit the form. | Exact field values accepted; no premature/incorrect submit |
| scroll | Scroll the list and select Item 24. | Target visible after scrolling and selected; no wrong actions |
| steps | Start review, then confirm the review. | Both ordered state transitions completed |
| recover | Recover from the displayed error using Retry, then confirm recovery. | Retry precedes confirmation; recovery complete |

Do not use the collapsed evaluator state, source files, devtools, DOM queries or the scripted `pilotPlan` as model hints during a desktop-only comparison. The observer uses the evaluator state to score after the trial. A browser-DOM-assisted native arm may be measured separately as an end-user route; do not silently mix its results with a desktop-only stratum. The HTML has been built and syntax-checked, not visually inspected or operated by this experiment.

## Establish the native baseline before live trials

The local installation can identify an application version, Computer Use plugin version and CUA runtime manifest without reading chats or credentials. Those static files do **not** establish the selected model, reasoning effort, service tier, active tool route, enabled feature flags or effective app permissions. The installed artifacts include both legacy sky instructions and unified CUA documentation. Record the route actually exposed to the fresh native test task; do not infer it from file presence.

Before a separately authorized trial, the operator must confirm a fresh native Codex/ChatGPT task selects `gpt-6.1-terra`, its effort and tier, and the exact Computer Use tool route. Record these alongside the customized worker route, app and tool versions, same-machine alias, OS, screenshot/viewport dimensions, DPR and browser zoom. Do not read old chats. Unknown values stay null and block an overall comparison. A DSH Desktop profile inspection says nothing about a separate daily Web process on another port; identify the test Host independently in an isolated profile.

The native Codex/ChatGPT desktop workflow is the primary baseline. An OpenAI API demo is `api_demo`, never a replacement for it. Match each trial's initial fixture state and hash, screen scale, requested/effective model metadata and task wording. Record any information the product does not expose as unknown. Model-name equality alone does not prove identical hidden backend weights or runtime policy.

## Later local execution procedure — not executed here

1. Obtain explicit authorization for the particular browser/app, real model requests and desktop control. Confirm any needed system permissions with the user; do not enable them automatically. Stop if the baseline route or real Host adapter is unavailable.
2. Build the page; record its SHA-256 and the source commit. On the same machine, open the standalone file in one approved browser and fix window size, display scale and zoom. No account is needed. Close unrelated sensitive windows through normal user preparation. Do not start a service or expose the fixture to the network.
3. Use a fresh test session/worker for each trial, matching the intended product behavior. Include child startup, model planning, screenshots, tool actions, validation, approval wait if any, and cleanup in end-to-end wall time. Record setup-only permission work separately. If persistent-worker reuse is later studied, give it a separate named stratum.
4. Pre-register an interleaved order: for repeat 1, odd tasks native→custom and even tasks custom→native; reverse on repeat 2. Reset, select the task, return scroll/focus to initial state, and confirm the evaluator is incomplete before **every** arm. Give both arms the same prompt and timeout. A reset failure invalidates both members of that pair; log the reason rather than dropping a failed task unnoticed.
5. Time from task submission until a verified terminal result and cleanup. The observer scores exact final state and wrong actions, and records failures, retries, cancellations and human intervention. A claimed success without the required UI state fails. Do not let either model score itself.
6. Record each arm as one JSON line conforming to `trial.schema.json`. Bind matching `pairId`, `taskId` and repeat. Keep raw synthetic-page action evidence locally for independent review; redact before sharing. `evidence: live` is an operator assertion, not an attestation generated by this scaffold.
7. Start with all five pilot tasks. Any incorrect action, permission surprise, outside-fixture action, unconfirmed cleanup or safety-related intervention stops the pilot. Incomparability, a missed discussion threshold or unresolved failures pauses productization. The pilot only decides whether a broader evaluation is worth authorizing.
8. After a clean pilot and review, pre-register **at least 30 distinct coverage tasks**, each repeated at least three times per arm with interleaved order. Repeating the original five does not create 30-task coverage. Add realistic density, focus, resize, delayed-state, stale-snapshot, recovery and cancellation cases before claiming useful coverage. This scaffold only implements the initial five.
9. Run `node experiments/terra-cua-worker/compare.mjs <local-trials.jsonl>`. Review all exclusions, paired differences, p50/p95 times, wrong actions, interventions and uncertainty. Do not merge benchmark files containing private runtime material.

## Metrics and proposed decision gate

**Discussion only, not user-approved:** success rate loss no greater than **5 percentage points**; end-to-end elapsed time and comparable visible task cost no more than **20% higher**. These are candidate noninferiority margins, not measured results or a guarantee. Agree on them before trials; do not tune margins after seeing results.

The reporter uses equal-weight task clusters, average success-rate loss and median within-task elapsed/cost ratios; it also reports per-arm success counts, p50/p95 time, wrong actions and interventions. Its deterministic 2,000-resample task-cluster percentile bootstrap keeps repetitions together. A narrow interval from five easy tasks does not establish equivalence. Task selection bias, backend drift and unobserved native behavior remain limitations even with 30 tasks. Independent review must assess coverage and uncertainty; add trials or pause when inconclusive.

Include unsuccessful/time-out trials in denominators and elapsed time. Record all attempts belonging to the task, not just the final successful call. `modelCalls` covers worker and auxiliary model calls; tokens may be null when unavailable. Use `visibleCost` only when both products expose the same whole-task unit, source and scope. Account-wide quota percentages and guessed API prices are not task cost. Missing comparable cost prevents an overall gate result; partial success/latency observations can still be reported separately. Do not manufacture a zero or inferred charge.

The reporter rejects synthetic/API records, missing baseline metadata, incompatible scales, duplicate/unpaired records and incomparable visible cost. The final status can only be `discussion_gate_met_requires_review`, never “equivalent” or “accepted.” A real successful gate still requires threshold approval, evidence review, actual Host compatibility and a separately authorized product decision.

## Verification evidence and limits

Initial local verification on Node `v24.13.0`: 14 offline tests passed; all five scripted pilot objectives completed with zero model calls; standalone HTML generated and its JavaScript parsed. Cancellation, timeout, revocation, lease exclusion, cleanup uncertainty and comparison rejection paths were exercised. No production runtime or dependency files were changed, so production Host/model matrices were not run. No GUI or real model acceptance was performed. Re-run the focused commands after changes; record current output rather than relying on this dated count.
