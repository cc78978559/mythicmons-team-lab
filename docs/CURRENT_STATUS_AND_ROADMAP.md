# Current Status and Roadmap

Release snapshot: 2026-08-09

This file records the Git release snapshot. Local `output/` artifacts can advance without a code commit, so live status must come from the signed commands below:

```powershell
npm run tooling -- status
npm run ai-pipeline -- status
npm run ai-pipeline -- doctor --verify-sources
npm run formal-canary -- status
```

The two readiness terms are deliberately separate:

- `evidenceEpochReady`: the latest formal season is covered by the current evidence policy.
- `canaryActivationReady`: a formally validated decision domain has a reviewed live adapter and may enter a controlled canary.

The first may be true while the second remains false.

## Release Snapshot

- Product: MythicMons V12, 30-manager formal league.
- Formal local history: `official-era-03`, seasons S1-S24.
- Audited battles: 18,460; fatal findings: 0; warnings: 0.
- Current-policy formal-context battles: 2,310 from S22-S24.
- Decision dossiers: 193,301 decisions from 1,566 indexed sources and 30 managers.
- Current evidence epoch: ready.
- Current canary activation: not ready; no domain has passed Stage 5.
- Formal state remains local under `output/` and is not committed to Git.

## Stage 0-6

| Stage | Capability | Engineering state | Decision authority |
|---|---|---|---|
| 0 | Evidence epoch and self-audit | Complete | Evidence policy |
| 1 | Decision dossiers | Complete | Historical observation |
| 2 | Position value | Complete | Shadow only |
| 3 | Manager Program V2 | Complete | Shadow only |
| 4 | Autonomous research | Complete | Shadow only |
| 5 | Formal validation | Complete | Validation only |
| 6 | Integrated doctor, status and resume control | Complete | No independent policy authority |

The engineering cycle is complete and healthy. Research maturity remains `iteration-required` because no Stage-5 mechanism has qualified for canary authority.

## Current Research Evidence

### Stage 2: Position Value

- 180 independent battle sources and 10,516 position samples.
- 19 model features, including seven structural team-context features.
- Test log-loss improvement: 32.50% versus a constant baseline, 12.59% versus material-only, and 4.11% versus the legacy model.
- Activation remains shadow-only.

### Stage 3: Manager Program V2

- 30 managers and 30 distinct behavior hashes.
- 27 managers use structural context in learned battle rules.
- Held-out improvement: 9.70%.
- `battle` is training-ready. `lineup`, `acquire`, `configure`, and `research` still require their own signed local-value evidence adapters.

### Stage 4: Autonomous Research

- 30 managers, seven rounds, and 210 independent experiments.
- 210 decision changes, 167 semantic trajectory changes, and 39 winner changes.
- All managers changed research intent; no experiment case was duplicated.
- The generation is healthy and remains shadow-only.

### Stage 5: Formal Validation

- 38 candidate mechanisms considered; two admitted to prospective validation.
- 1,320 prospective source battles and 34 completed experiments.
- 25 trajectory changes, six winner changes, zero technical attempts, and zero unresolved failures.
- Hazard mechanism: inconclusive, with one support and one contradiction.
- Conditional physical-attack mechanism: inconclusive, with four supports, zero contradictions, and Holm-adjusted `p=0.125`.
- Current handoff: signed `no-candidate`; automatic activation is forbidden.

## Product Boundary

The league engine, persistence, recovery, market, season lifecycle, evidence pipeline, and autonomous research loop are operational. A production autonomous manager is not yet delivered:

- Battle decisions have the complete research path but no formally activated mechanism.
- Lineup, acquisition, configuration, and research policy domains have isolated program interfaces but no formal per-decision evidence path.
- Personality mutation and academy market actions remain shadow policies.
- Formal seasons require an operator to start them; there is no unattended scheduler or off-device evidence backup.

## Next Research Cycle

1. Stage 4 reads the signed formal portfolio and lets each manager choose whether to replicate, revise, replace, or abandon a mechanism.
2. Duplicate cases and exact rejected semantic variants remain ineligible.
3. Stage 5 admits only novel mechanisms with sufficient manager support, independent cases, independent sources, and no unresolved contradiction.
4. Formal validation uses independent modern-benchmark and current-league environments with cluster-level inference.
5. No sample count grants authority by itself.
6. The first passing decision domain may enter a two-season canary at a 10% application rate, capped at 12 applications per season, with manual promotion and automatic rollback triggers.

## Release and Operations

- `npm run check:affected -- --no-cache` is the normal development gate.
- `npm run check:compact -- --no-cache` is the release gate and currently covers 102 selected tests plus type checking.
- `npm run tooling -- doctor` performs the unified storage, cache, dynasty, pipeline, signature, and canary audit.
- Content-addressed dynasty storage, stage archives, source-cache references, and safe GC are active.
- Git stores code, rules, tests, and reproducible commands. Large formal evidence requires separate backup.

## Delivery Sequence

1. Keep the current-state document and generated release baseline aligned with each code release.
2. Run autonomous Stage 4 research from the latest signed formal portfolio.
3. Run Stage 5 only when the selector finds eligible novel mechanisms.
4. Start the controlled canary only after a domain passes and its live adapter is locally reviewed and hash verified.
5. Add evidence adapters one domain at a time for lineup, acquisition, configuration, and research decisions.
