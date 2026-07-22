# MythicMons architecture

## Runtime flow

`draftLeagueV12.ts` pins the current policy and registry settings, `draftLeagueV4.ts` owns the multi-season career, economy, lineage, and evidence lifecycle, and `draftLeagueV3.ts` runs one season through the Showdown battle adapter. The official cycle wraps that runtime with audit, development-league, promotion, retention, and history-ledger gates.

```text
official season cycle
  -> V12 policy adapter
    -> V4 dynasty orchestration
      -> V3 single-season simulation
        -> Showdown battle engine
```

White-box candidates remain shadow-only unless their domain-specific evidence and release gates explicitly approve them. An executable counterfactual route is not an activation decision.

## State ownership

`dynasty-state.json` is the active, hash-bound checkpoint. New checkpoints keep large append-only histories outside the active core:

```text
dynasty-state.json
.dynasty-state/
  decision-records.<payload-sha256>.json.gz
  evolution-archive.<payload-sha256>.json.gz
```

The main file contains `stateStorage` references with compressed and uncompressed hashes, byte counts, and item counts. Loading through `loadDynastyState()` verifies and transparently hydrates both archives. Legacy states with inline `decisionRecords` and `evolutionArchive` remain readable.

Archives are content-addressed and written before the main state is atomically replaced. A crash before main-state replacement leaves only an unreferenced archive; an existing checkpoint never points to partially written history. Promotion rollback restores the exact prior main state, whose references continue to address its prior archives.

Commands that only need the active boundary may read the core directly. Commands that inspect decisions or evolution history must use `loadDynastyState()`.

## Evidence and retention

- Season evidence is immutable after a completed boundary.
- Formal state hashes bind the archive hashes through `stateStorage`.
- White-box terminal retention preserves `dynasty-state.json` and `.dynasty-state/**`.
- Development-league compaction extracts the manager boundary before pruning its simulation directory.
- Audit, promotion, counterfactual, release, and career-archive paths hydrate verified history.

## Checkpoint branches

Counterfactuals that intervene only after a completed season use `dynastyCheckpointBranch.ts`. A branch manifest binds the exact main-state bytes to the completed season summaries, evolution summaries, health summaries, active registry snapshot, and referenced history archives. Its content-derived checkpoint ID must match across experiment and control.

Materialization copies only the files required to resume the dynasty. It requests copy-on-write cloning and safely falls back to ordinary copies; it never hard-links writable evidence back to the formal source. The branch verifies the full boundary immediately after materialization and verifies the immutable prefix again after continuation. Historical interventions inside an already completed season still require an exact replay from an earlier compatible checkpoint.

The formal S21 source is not rewritten merely to create a branch. Its legacy inline state is copied as-is and naturally converts to split storage when the experimental continuation writes its next checkpoint.

## Historical runtime checkpoints

New V12 journeys retain a compressed state boundary from `season-00` onward under `.season-checkpoints/season-NN/`. Each boundary binds the exact main-state bytes, referenced history archives, registry snapshot, runtime fingerprint, and a content-addressed runtime bundle. A code version is stored once under `.runtime-bundles/<runtime-id>/`; its executable workspace contains production TypeScript, benchmarks, package manifests, and the lockfile, but not `node_modules` or test sources. The unpacked runtime is about 2 MB with the current codebase.

An intervention in season N is replayable only from the season N-1 state with the runtime recorded for season N. This deliberately reproduces a code upgrade that occurred at the start of N. Runtime files, state archives, registry data, the installed lockfile, and the Pokemon Showdown version are verified before execution. A follow-up horizon is partitioned into adjacent runtime segments and the branch resumes under the recorded runtime at each boundary; adjacent seasons using the same runtime are executed together. Future seasons beyond the retained source reuse its latest verified runtime. Registry, dependency-lock, or Pokemon Showdown transitions remain blocked because they require an isolated dependency and data environment rather than a code-only switch.

These artifacts are prospective. Formal S21 predates them, so its two recorded code transitions remain `requires-gate`; the system does not infer exact historical bytes from Git commits because the legacy code hash included checkout-specific line endings.

## Compatibility rule

State-storage and checkpoint-branch changes must not alter manager state, seeds, settings, decision order, evolution inputs, or battle outputs. Acceptance requires legacy-load, split-load, tamper rejection, branch-source isolation, resume, audit, promotion rollback, official-cycle, and counterfactual smoke coverage.

## Validation topology

Local `npm run check:compact` remains a complete serial validation command with hash-bound per-test caching. Pull-request validation divides the same discovered test set into four deterministic shards. Only shard zero runs the global TypeScript check; every smoke or regression script belongs to exactly one shard. Each isolated GitHub runner restores its own result cache, and `checkAffected.ts` revalidates every restored entry against the current transitive source hash before reuse.
