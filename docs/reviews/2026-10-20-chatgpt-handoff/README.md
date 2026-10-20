# Maintenance handoff — 2026-10-20

This public index contains only links to existing public repository records and proposed next steps. It does not publish private review material, unpublished security findings, local candidate implementations, account data, or approval records.

## Baseline

- [Main reviewed baseline](https://github.com/franksong2702/dsh-codex-connect/commit/e5579b71339ba932dec7dfba497fc97df8fbf124)
- Always re-read AGENTS.md and current branches before continuing. Do not treat this dated snapshot as current test or merge evidence.

## Remaining work

1. [PR #358](https://github.com/franksong2702/dsh-codex-connect/pull/358): test-fixture writer cleanup. Review the latest PR head and its validation report. This change does not claim to repair production lock timeouts. Preserve failure propagation and concurrent coverage; merge only after applicable review and checks pass.
2. [PR #327](https://github.com/franksong2702/dsh-codex-connect/pull/327): follow the draft's publicly documented storage and approval-validation scope. Reconcile current main, validate the resulting exact head, and distinguish synthetic tests from platform-native acceptance. Do not use real account data for synthetic testing.
3. [Issue #65](https://github.com/franksong2702/dsh-codex-connect/issues/65): follow the current narrowed maintenance scope in the issue, rather than the historical experiment roadmap. A local Host patch is not evidence of an official Host release fix. Keep unresolved observations explicit.

## Continuation workflow

Discover the connected WebCodex tool contracts and exact project identity before making changes. Prefer direct file and command tools for bounded tasks. Do not assume a workflow session launches a model, and do not silently start an additional coding agent. Preserve branch history, use no force push, and record exact source versions and executed checks. Changes to daily services, release publication, real credential migration, and security settings require their own applicable authorization.

No PR is claimed merged by this document. Consult GitHub status and the PR discussions for the latest evidence.
