# Manager Mechanism Ledgers

Manager mechanism ledgers preserve what each manager has personally observed about a candidate mechanism. They are deliberately separate from the public hypothesis registry: a league-wide correlation can suggest an experiment, but it cannot become a manager belief without manager-specific evidence.

## Safety boundary

- Ledgers are `shadow-only`. They do not alter drafting, lineup selection, battle actions, or evolution scores.
- Exact counterfactual evidence has weight `1`; matched local evidence `0.5`; natural outcomes `0.15`; social observations `0.05`.
- A mechanism remains `exploring` or `watch` until repeated evidence reduces uncertainty. Status is descriptive, not a policy switch.
- Evidence IDs are deduplicated. Each manager is bounded to 64 mechanisms, 24 contexts per mechanism, and 256 recent evidence IDs.
- Contexts are manager-local. A useful result in one roster, opponent, or season context is not silently generalized to every situation.

## Persistence

The compressed dynasty state stores one ledger per manager in a separate `mechanism-ledgers` archive. Historical runtime checkpoints include that archive, and career-memory checkpoints carry it into a new journey. Legacy checkpoints without ledgers remain valid and receive empty ledgers.

Competitive records, assets, contracts, and money still reset between journeys. Personal mechanism evidence does not.

## Low-token commands

Build a shadow preview from completed causal studies and include all 30 managers, even those without evidence:

```powershell
npm.cmd run manager-mechanisms -- preview --manager-count 30
```

The command writes `manager-mechanism-ledgers.json.gz`, `summary.json`, and `token-budget.json` under `output/tooling/manager-mechanism-ledgers`. Its console output is intentionally compact.

The operation is incremental. Completed causal cases are registered by mechanism and case identity. Running it again reports them as `unchanged` and does not increase any manager's evidence count. If a previously imported case has different evidence later, synchronization stops instead of counting both versions.

Lineup causal studies call this synchronization automatically after their summary is sealed. They write `mechanism-ledger-sync.json` beside the study for provenance. Set `MANAGER_MECHANISM_AUTO_SYNC=false` only for an isolated test; `MANAGER_MECHANISM_LEDGER_OUT` can redirect the shadow ledger. Automatic synchronization updates only the shadow ledger directory and never edits the official dynasty.

Inspect one manager without loading the full ledger:

```powershell
npm.cmd run manager-mechanisms -- show --archive output/tooling/manager-mechanism-ledgers/manager-mechanism-ledgers.json.gz --manager manager-01
```

Add `--full` only when context-level evidence is needed. Audit a persisted dynasty with:

```powershell
npm.cmd run manager-mechanisms -- audit --source output/official-era-03
```

Add `--details` only when all manager summaries are required. Normal review should read the compact console result, `token-budget.json`, or one manager summary rather than the full dynasty state.

Audit experiment opportunity coverage without reading every manager ledger:

```powershell
npm.cmd run manager-mechanisms -- coverage --archive output/tooling/manager-mechanism-ledgers/manager-mechanism-ledgers.json.gz
```

This reports managers with and without evidence, minimum/median/maximum attempts, concentration (`gini`), per-mechanism coverage, and a bounded under-sampled list. It is an audit signal only and does not assign play styles or change experiment outcomes.

## Experiment opportunities

The lineup hypothesis planner reads the shadow ledger by default. Its constrained optimizer preserves all hard experimental requirements: three-season balance, equal source wins and losses, hypothesis guardrails, minimum treatment strength, and at most one case per manager. Among equally legal plans it minimizes prior mechanism attempts, then prior total attempts. Treatment strength and a hypothesis-bound deterministic rotation resolve remaining ties.

This changes who receives a scarce experiment opportunity, not what the manager believes and not which result is preferred. The planner cannot inspect future counterfactual outcomes. Every plan records `opportunityPolicy`, selected prior-attempt coverage, and the SHA-256 fingerprint of the ledger archive used to allocate opportunities. Use `--ignore-personal-evidence` to reproduce the older balanced-only allocator.

## Personal research agendas

Managers now submit their own ordered research requests before opportunity allocation:

```powershell
npm.cmd run manager-research -- plan --round 1
npm.cmd run manager-research -- show --archive output/tooling/manager-research-agendas/research-agendas.json.gz --manager manager-23
npm.cmd run manager-research -- audit
```

Every manager begins with the same novice research policy. The subsystem does not reuse the league's generic exploration trait. A manager can request a newly approved public causal question, replication of a personal positive result, mapping of a personal failure boundary, or resolution of contradictory local evidence. Publicly unapproved questions remain deferred.

The causal allocator maximizes first-choice requests before considering mechanism exposure, total exposure, or deterministic tie-breaking. Hard causal strata and safety guardrails still take precedence. The first real safe-speed plan honored all 19 first-choice requests and filled its remaining five positions from lower-ranked volunteers while preserving 8/8/8 season and 12/12 source-outcome balance.

The completed safe-speed study ran 24 manager cases and 48 paired games with no failures or unused substitutions. It produced 2 better, 19 neutral, and 3 worse cases (`pairedScore=0.479167`) and was registered as `no-clear-benefit`. Improvements occurred only in source losses and regressions only in source wins, so the aggregate claim is closed while personal replication and boundary-mapping questions remain eligible. Round-one review records 19 first-choice and five lower-choice executions in an immutable agenda snapshot plus a compressed per-manager detail archive.

Round two ran a six-manager role-compression replication selected from five first-choice and one second-choice volunteer. It produced 2 better, 3 neutral, and 1 worse cases. Round three used the same volunteer rule for effective-speed pressure and produced 1 better, 3 neutral, and 2 worse cases. Across safe speed, role compression, and effective speed, improvements appeared only in source losses while regressions appeared only in source wins. This is retained as a boundary observation, not activated as a lineup rule.

A round-three audit found that two of its six effective-speed cases reused exact historical intervention IDs from the first study. Ledger import deduplication had correctly refused both, but the research review had initially rewarded them. The corrected review starts from the immutable round-two policy and round-three agenda snapshots, accepts four first-seen cases, and archives the superseded policy, report, details, and derived round-four agenda by content hash. Plans now exclude every prior intervention ID from the import registry, lock that registry hash into the protocol, and reviews independently reject any result whose first-import study differs from the current study. Round four then added six genuinely new effective-speed cases with zero duplicate rejection, producing 1 better, 2 neutral, and 3 worse results.

## Shared causal source cache

Causal studies reuse a read-only S21-to-target-season preparation keyed by the official state hash, target season, and current non-test source, benchmark, and dependency inputs. Creation is locked and atomically published. Reuse verifies the final state plus every target-season summary and decision ledger hash. Invalid caches are rejected unless the operator explicitly requests a bounded rebuild. A real S24 validation took 395.3 seconds to build and 4.5 seconds to reuse from a separate study directory, about an 88x reduction in repeated preparation time.

Reviewed personal replications may use 1-30 consenting managers instead of the population experiment's multiple-of-six requirement. The allocator maximizes season-by-source-outcome coverage without filling a missing stratum from non-volunteers. These studies are labeled `personal-local-replication` and report `personal-results-only`; their individual exact counterfactuals update personal ledgers, but their aggregate score cannot replace a population causal conclusion.

Round five exercised this path with all five safe-speed volunteers: five first-choice requests, five independent historical interventions, and ten paired games. The results were 1 better, 3 neutral, and 1 worse with ten action divergences and four changed outcomes. All five cases were accepted without duplication, raising safe-speed exposure from 24 to 29 attempts. The aggregate remains `personal-results-only`. After review, every manager has at least two mechanism attempts (median 4, maximum 5; opportunity Gini `0.136257`). Round six agendas have been prepared but no round-six study has been run.

## Retrospective boundaries

The boundary audit intentionally separates an interesting retrospective pattern from information a manager could actually know at decision time:

```powershell
npm.cmd run shadow:causal-boundaries -- --permutations 20000 --season-source output/tooling/shadow-lineup-source-cache/<cache-key>
```

Across 114 first-import counterfactuals, interventions after source losses averaged `0.155172`, while interventions after source wins averaged `-0.321429` (difference `0.476601`; stratified permutation `p=0.00005`). The direction survives each leave-one-mechanism-out check. However, `sourceOutcome` is the outcome produced after the lineup decision and is therefore unavailable when that decision is made. The audit labels this only `retrospective-boundary-candidate`, sets `decisionTimeAvailable=false`, and makes it permanently ineligible for policy activation.

Three genuinely prospective proxies were reconstructed from matches completed before each decision. Previous-match loss had effect difference `-0.057203`; recent-three high loss rate had `-0.01096`; season-to-date high loss rate had `-0.004329`. None was significant after correction, so the proxy screen reports `no-prospective-proxy-ready`. No public hypothesis, research request, manager preference, or active lineup rule is created from this result. Future work must test new pre-decision variables directly rather than renaming the leaked retrospective split.

## Prospective question incubation

The prospective lineup incubator searches only diagnostics available when a lineup is selected. It uses the earlier seasons to choose each feature's direction, percentile scale, and manager baseline, then freezes them before evaluating the final held-out season. Validation uses one-sided sign permutation tests with Benjamini-Hochberg correction across every scanned feature. Duplicate observations and malformed two-sided series are rejected, and output records SHA-256 fingerprints for both the sample archive and hypothesis registry.

```powershell
npm.cmd run shadow:lineup-incubator -- --permutations 20000
```

The first S22-S24 run scanned 26 features over 739 discovery pairs and 367 held-out validation pairs. Two features replicated: higher `lineup.strengthFloor` (discovery effect `0.077526`, validation effect `0.167723`, `q=0.02015`) and higher `lineup.speedAdvantageMean` (`0.176911`, `0.106005`, `q=0.089479`). Both already belong to registered mechanisms, so the result is `no-prospective-candidate-ready` with zero novel promotions.

The incubator also generates every two-factor program whose constituents clear a discovery-only activity gate. The first run tested 66 such programs. Each program must replicate in the held-out season and must separately outperform both constituent features under paired incremental tests; significance is corrected across all 132 constituent comparisons. A provisional speed-median plus strength-floor result was correctly rejected after this stronger audit: it improved on speed median but not on strength floor. No two-factor program was promoted.

Representation v4 adds raw counts for ten roles already present in each configured set: hazards, removal, recovery, pivoting, setup, priority, screens, status, physical offense, and special offense. These are observations only and carry no authored utility weights. A frozen S21 shadow replay produced 2,238 S22-S24 traces, 36 diagnostics, and 32 variable diagnostics. The v3/v4 histories matched on all 2,238 observation IDs with zero incumbent-lineup or outcome changes, confirming that v4 is observational only.

The S22-S24 screen showed held-out positive movement for priority and setup counts, but neither had enough earlier discovery evidence to advance. A new S25 was therefore generated from the verified S24 cache, then joined to the earlier compressed sample through a continuity-checked, hash-provenanced merge. With S22-S24 frozen as discovery and S25 as the new holdout, priority reversed (`validationEffect=-0.150246`) and setup became neutral (`0.000588`). Across 36 features and 231 two-factor programs, only the already registered strength floor and relative speed advantage replicated; no new feature or program was promoted.

The full v4 evidence path is local and compact. Three-season replay took 485.4 seconds, the incremental S25 replay took 190.5 seconds, temporary season outputs were removed, and the merged 2,990-row S22-S25 archive is about 0.89 MB. Routine review reads an approximately 300-token summary instead of battle logs or the full program table.

Representation v5 adds matchup-conditioned physical, special, and priority pressure plus defensive safety windows for utility roles. Its first four-season replay retained 2,990 traces with 61 diagnostics, 51 of them variable. The session disconnected after S25 completed but before aggregation; `--recover-completed-work` finalized the intact trial without replaying it. Recovery now removes only a dead owner's workflow-specific lock, verifies every season summary and decision ledger, preserves incomplete work on validation failure, and cleans the trial only after successful publication.

The v5 outcome audit tested 61 single features and 528 two-factor programs using S22-S24 discovery and S25 validation. Only the already registered strength floor survived correction. No matchup-conditioned feature or program was promoted. The new telemetry remained observational: all 2,990 v4/v5 observation IDs matched with zero incumbent-lineup or outcome changes.

The initial v5 implementation exposed a performance defect: member-versus-opponent vectors were recomputed for every 8-choose-6 candidate. Per-decision member preparation now computes each vector once and reuses it across all 28 combinations. A fresh S25 replay fell from an old-v5 per-season average of 434.0 seconds to 194.3 seconds (`2.23x` faster), with 0 missing observations, 0 lineup changes, 0 outcome changes, and 0 selected-diagnostic changes.

This is a successful negative result. It does not manufacture research work for managers with neutral ledgers, and it does not reactivate the two known features from observational evidence. A future run may produce a new shadow causal question after additional seasons or a genuinely new decision-time representation. Even then, the manager chooses whether to request the question; incubation never changes policy weights or personal preferences.

Research policies are stored separately from agendas. A review updates them only from information quality: treatment expression, outcome-changing evidence, and replication consistency. Positive and negative battle directions are both informative. The next round is rejected until the preceding agenda has been reviewed, preventing unsupported personality drift.

```powershell
npm.cmd run manager-research -- review --studies path/to/completed-study
```

This review command is intended for a study planned from the corresponding agenda round. Unexecuted requests advance without fabricated evidence; executed requests update only that manager's research-mode history.

## Tactical timing representation

The next observational layer records when a manager acts, not a centrally authored definition of good tactics. Each row has three physically separated sections: public battle state captured before the turn, the contemporaneous selected action, and the observed one-turn, three-turn, and final outcomes. Post-decision fields are explicitly activation-ineligible. The representation includes remaining members, normalized team and active HP, status and field-resource counts, action kind, candidate availability, and score margin; it contributes no utility weight to live battle selection.

```powershell
npm.cmd run shadow:tactical-timing -- --source output/official-era-03/league/season-21 --out output/tooling/tactical-timing-s21
```

The legacy S21 archive contains all 772 public battle logs. Fifty-two sampled or playoff games retain full candidate traces; the other 720 retain six preselected key decisions. Offline extraction produced 6,312 temporally matched rows for all 30 managers with zero unavailable games, zero unmatched decisions, and zero state-range violations. The gzip archive is about 250 KB. The two evidence frames remain labeled separately because key-decision summaries are not an unbiased all-decision sample.

The machine-readable readiness audit therefore classifies legacy S21 as `parser-validation-and-bounded-retrospective-only`: only 12 managers appear in the all-decision full-trace frame and no population-wide compact all-decision frame exists. The 4,320 highlighted legacy rows may support replay narration and targeted case review, but cannot nominate a general tactical mechanism. This block is structural rather than an authored sample-count threshold.

Future compact seasons now retain `ai-timing.json.gz` for every ordinary battle before deleting the large candidate tree. This stores one small record per decision: turn, player, selected action, final-score margin, action kind, Terastallization flag, and manager identity. Full sampled traces remain the calibration frame for rational-score and personality diagnostics. Existing `ai-summary.json` files remain human-facing highlights rather than the manager's statistical sample. This raises future coverage from six selected moments per compact game to every decision without retaining response trees or replaying battles.

## Interpretation

`unseen` means no evidence. `exploring` means evidence is scarce. `watch` means there is enough evidence to estimate direction but uncertainty remains material. `locally-promising` and `locally-negative` describe repeated personal evidence only; they do not claim a universal Pokemon rule.
