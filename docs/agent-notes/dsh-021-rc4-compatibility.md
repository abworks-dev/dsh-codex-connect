# DSH 0.2.1-rc.4 compatibility candidate — 2026-10-28

This records the initial rc.4-only stage at source `ac73103b39b67e0bec255df3de51fc20d6d4e20a`. Its archive `5068c416…` and matrix remain historical evidence. After #397 merged, the combined Alpha 11 source and its distinct acceptance identity are recorded in the [joint acceptance report](alpha11-joint-acceptance.md); the results below must not be reused as that combined package's acceptance.

Issue [#396](https://github.com/franksong2702/dsh-codex-connect/issues/396) preserves the original stock next-canary refusal at `2e6a9d7a4d2ec7833003311745ff139056bc399f`, [run 40475574233](https://github.com/franksong2702/dsh-codex-connect/actions/runs/40475574233). It is an exact-support declaration gap, not an established runtime regression. This independent branch starts at main `ed099b7119ab258f78d020b92d1bf9f1a666518d`; it does not depend on or merge external PR #397.

## Published-package evidence

The complete DSH-only dependency, peer and optional-dependency closures contain 296 packages in each release, with no added/removed package names. All **592 actual npm archives** match registry SHA-512 integrity and SHA-1 shasums. The [machine-readable inventory](dsh-021-rc4-package-evidence.json) records every package, URL, integrity, shasum, SHA-256 and size, along with the source imports audited. Every archive file was compared after replacing only the two exact version strings; manifests and version-only differences were retained separately in the local comparison.

| CLI artifact | SHA-256 |
| --- | --- |
| [rc.3](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.3.tgz) | `9a8f9493bfab8218215a8ca38ab8821e76dff63dc4fcb65841ef87c0aa277141` |
| [rc.4](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.4.tgz) | `1fddead34d3c943b7a4eed1d614e14fa19925803455e28c5141645caf4b02d13` |

The upstream `dsh-v0.2.1-rc.3` tag resolves `1f81c047fc48fa190a683e469daa699857e9afe8`. The correctly prefixed rc.4 tag/release endpoints initially returned 404. During the matrix run, the [rc.4 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.4) became public (`published_at=2026-10-28T02:49:58Z`); final readback resolves its tag to `504a01a9578abc2c6f1fb896b1dc322c9fe24f66` and describes the ACP stdout diagnostic fix. The earlier 404 observation is retained as historical evidence. npm manifests still omit `gitHead`; the client bundles identify short build commits `be72761` and `ec17a2c`. Tag visibility alone does not bind the published archive bytes to those source trees, and that mapping was not asserted. No source diff or physical Desktop comparison substitutes for the package evidence.

Six packages have non-version changes:

- `dsh-client-ui-conversation`: View-tab tooltip width estimation, removal of the internal `session.moreViewsCurrent` locale key, and corresponding documentation. The Composer injection slots and component contracts used by Codex Connect remain. This plugin does not use the removed locale key or the View-tab helper.
- `dsh-client-ui-sidebar` and `dsh-client-modules`: the embedded build commit changes.
- `dsh-llm-deepseek-account`: model-list informational logging moves from stdout to stderr.
- `dsh-mcp-client`: resource/template listing returns empty pages when a server does not advertise resources. Tool execution and resource-read calls are unchanged.
- `dsh-mcp-resources`: documentation only.

All DSH package exports and dependency/peer requirements are unchanged after exact-version normalization. The consumed LLM/PiAI, agent/session, attachment, compaction, filesystem, settings, tools, Host webserver, WebRuntime, primitives/layout/chat and plugin-manager implementations/declarations have no non-version changes. Both closures request Cordis `~4.0.5`, Loader `~1.0.6` and Host pi-ai `^1.1.0`; the local rc.4 installer resolves Cordis `4.0.5` and Loader `1.0.6`. The plugin continues to own separate pi-ai `0.85.1`. Actual Loader tests, rather than equality of dependency requirements, verify ownership behavior.

## Original refusal and candidate

The unchanged main-source archive is SHA-256 `feb833955d534a082de171cac1cfe4e73ec4c5940a3899604ba3713842f9ea01`. This is a local build, not the immutable published Alpha 10 archive. Stock rc.4 rejects its peer requirements ending at rc.3. The [path-redacted raw stderr](dsh-021-rc4-baseline-rejection.txt) preserves the refusal, rollback and inactive exemption. No `allow-version`, force, legacy-peer, permission or gate override was used. Raw local stdout/stderr and the first checker failure are retained separately. The checker's last-lines summary was initially dominated by installer progress; the second run added only raw-stream capture around the same stock operation and exposed the actual refusal.

The two new Node-policy assertions first failed against unchanged declarations (39 passed / 2 failed). The candidate extends only exact rc.4 to 19 required DSH peers, optional commands peer, packaged contract, shared Host/browser policy and validation gates. It retains the twelve prior Hosts, pi-ai `0.85.1`, development SDK, runtime dependencies, Node range, model defaults and Task pause. Regression cases retain rc.3/rc.4 mixed-peer refusal, missing metadata, future rc.5/stable refusal and pi-ai mismatch. The policy suite then passed 42 tests.

The first Alpha 11 candidate passed the unmodified installed-Host checker on Node `v24.13.0` and pinned npm `10.9.3`, normal peer checks, empty npm configs, scrubbed credential environment and a disposable `DSH_HOME`. That intermediate archive was `e7becdec9ee4d9433bc14b0b9c8f28d88467ccfff37d80cab02b5f09a423030e`; it preceded documentation updates and is not the final matrix artifact.

The result covers stock add, unchanged model/Web defaults, default-off optional flags, profile composition/startup help, missing-credential doctor JSON, all 12 model resolutions/reasoning projections/preparations, disposal, metrics and paused Task HTTP. Search runs through the actual Host Loader: two reloads, four Host selection round trips including between-search updates and unset ambiguity, source limits, unchanged Fetch routing and restoration. Installed preflight has six cases for delayed headers, finite deadline, idle preservation and cancellation; retry policy has six prepared-policy/default/disposal cases. Synthetic image generation/editing, inherited source/download ownership and denied unrelated sessions pass with zero real provider requests. Native compaction uses ten fresh processes across plain/zstd persistence, resume/fork/child, failure/cancel and automatic-pressure scenarios. These are preserved existing regressions, not new Task activation.

## Full local validation

The locked dependency install passed with pnpm `10.30.3`; no lockfile or development dependency was changed. The full `pnpm run check` passed on Node `v24.13.0`: 172 test files, **2,382 passed / 2 existing skips**, lint and both typechecks, workflow contracts, build, isolated/environment-proxy imports, offline capability/request-metrics CLI, compatibility gate and 72-file package validation. The upstream primitives package still emits a non-failing missing-source-map warning. The final focused compatibility/catalog/installation-guidance run passed 3 files / 75 tests. Chromium `pnpm run test:browser` passed 14 files / 97 tests using task-local browser binaries and scrubbed credentials.

The first manual baseline `npm pack` preparation tried the default user npm log/cache directory and failed before producing an archive. Repeating it with the already designated task-local npm cache and empty configs succeeded; no user npm configuration or permissions were changed. This preparation failure is separate from the retained stock compatibility refusal.

## Delivery and limits

The complete unmodified `node scripts/check-dsh-matrix.mjs` entrypoint (`pnpm run check:dsh-matrix`) passed **all 13 exact Hosts** with npm `10.9.3`, normal peer checks and one identical final Alpha 11 tarball. The [matrix report](dsh-021-rc4-matrix.json) retains each Host identity and runtime contract; verbose compaction child reports and process IDs remain only in raw local evidence. The matrix ran from 02:46:32 to 03:20:46 UTC on 2026-10-28. No Host candidate repair or exemption was used.

Final tarball SHA-256: `5068c416e11f32935f5846ce45e26a18052a2014a2544b79fccd7e5cc1fb4f83`. A separate final `npm pack --ignore-scripts --dry-run --json` review and retained `npm pack --ignore-scripts --json` archive agree on all 72 files (1,474,332 bytes); the retained archive hash matches every matrix report. Agent notes and the raw evidence inventory are excluded from the package. `git diff --check` passed. Generated files were rebuilt by the project commands, never hand edited:

| File | SHA-256 |
| --- | --- |
| `lib/index.js` | `8145f3f9cd75bbeb90b596d4933ecf0b4f3f88287802d2d9a7874b703c7bb26c` |
| `lib/client.js` | `da93b6facb713679645f2245789e7eb248d5ce01e1f761877c3f157a2fc7dc42` |
| `lib/bin.js` | `a9ed65476ead64b3464c07412d2f774237af9ed0b45596417a8b378301df6c9a` |

The two local skips are Windows-only native read-only sync and artifact-link cases in `task-flush-native.spec.ts` and `task-artifact-native.spec.ts`. The macOS run does not replace Windows CI. Local installed-Host validation uses Node 24; Node 22 policy assertions are synthetic inputs, not a local Node 22 runtime matrix. Exact-head remote Node 22/24 and Windows results remain separate evidence.

Alpha 11 is an unpublished source candidate. Its catalog entry does not make the npm package available, and historical Alpha 10 support is not rewritten. Public install commands remain Alpha 10 / rc.3 pending separate authorized publication and readback. No package publishing, production deployment, daily service restart/upgrade, new credentials, permission change or security-check reduction is included.

All model responses/accounts are synthetic. Keyless installed-Host tests and Chromium browser checks do not establish real OAuth/model access, native Desktop/iPhone, Safari/VoiceOver, keyring migration or full user acceptance. Physical Desktop and real-account acceptance remain unperformed. Exact commit/CI results must be recorded independently; old passing heads are not current evidence.
