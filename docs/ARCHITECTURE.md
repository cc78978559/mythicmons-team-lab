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

## Compatibility rule

State-storage changes must not alter manager state, seeds, settings, decision order, evolution inputs, or battle outputs. Acceptance requires legacy-load, split-load, tamper rejection, resume, audit, promotion rollback, official-cycle, and counterfactual smoke coverage.
