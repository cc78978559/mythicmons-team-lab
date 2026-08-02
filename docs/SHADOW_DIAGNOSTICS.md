# Shadow Diagnostics

The shadow diagnostic layer explains why a candidate policy fails before any further simulations are scheduled. It is local, deterministic, resumable through its input signature, and does not call an external model.

## Commands

```powershell
npm run shadow -- diagnose `
  --source output/official-era-03/league `
  --development output/official-era-03/development-season-22 `
  --out output/tooling/shadow-diagnostics

npm run shadow -- report --out output/tooling/shadow-diagnostics
npm run shadow -- queue --out output/tooling/shadow-diagnostics
npm run shadow:refresh-lineup -- --limit 12 --target-season 6
npm run shadow:lineup-pilot -- plan --target 30
npm run shadow:lineup-pilot -- run --target 30 --max-cases 3
npm run shadow:lineup-pilot -- report
npm run shadow:lineup-review
npm run shadow:lineup-representation
npm run shadow:lineup-efficiency
npm run shadow:lineup-outcomes
npm run shadow:lineup-speed-plan
npm run shadow:lineup-speed-run -- --max-cases 24 --concurrency 3
npm run shadow:lineup-hypotheses
npm run shadow:lineup-hypothesis-plan -- --hypothesis lineup-role-compression-v1 --requested 24
```

Use `--force` only to bypass a matching cache. `inventory` currently performs the same bounded scan as `diagnose`, retaining the diagnosis so a second pass is unnecessary.

## Causal funnel

The report distinguishes:

1. observed shadow decisions;
2. incumbent/shadow disagreements;
3. live-gate recommendations;
4. exact paired outcome studies;
5. out-of-source predictive calibration.

Large raw counts are not treated as independent causal samples. Agreement-only traces establish observability but provide no treatment contrast. Neutral paired outcomes establish expression without competitive value.

## Outputs

- `shadow-diagnosis-summary.json`: compact machine-readable navigation and conclusions;
- `shadow-diagnosis-report.md`: human-readable tables and failure modes;
- `shadow-diagnosis-details.json.gz`: contribution groups, season trends, normalized gate reasons, and full study metadata;
- `shadow-experiment-queue.json`: a bounded navigation queue of real disagreements and close agreements, including replay-readiness blockers;
- `token-budget.json`: byte size and estimated cost of reading the compact summary.

No raw decision example, team, manager profile, or battle log is copied into the diagnostic output. The evidence registry contains only reviewed aggregate results and source-document provenance. Updating that registry triggers the dedicated smoke test through `check:affected`.

## Interpretation

`candidate-collapse` means the shadow is an explanation of the incumbent rather than an alternative policy. `low-treatment-contrast` means only a small fraction of observations can support causal replay. `single-proxy-dominance` means one score group overwhelms the intended contextual signals. `gate-suppression` means alternatives exist but fail the unchanged safety gate. `impact-calibration-failure` means a model can sometimes predict direction but cannot predict whether the decision matters. None of these labels authorizes a live policy change.

A close agreement is diagnostic evidence, not treatment evidence. The planner searches for the smallest bounded style rescore that changes the selected candidate. A case is replay-ready only when that flip exists and the retained trace contains every candidate. Compact historical traces remain useful for locating pressure points, but they are explicitly blocked until a deterministic replay refreshes the full candidate set.

The targeted lineup refresh avoids switching full trace retention on for the whole league. It materializes the checkpoint immediately before one target season, runs that season with its recorded historical runtime, verifies the unchanged outcome, stores selected traces as gzip, and deletes its temporary replay tree. Its output can feed later counterfactual scheduling without becoming another permanent dynasty copy.

## Historical boundary pilot

The first targeted S1 refresh recovered two complete 28-combination lineup traces. Their incumbent margins were `0.000020` and `0.000036`; bounded style scales of `1.01` and `1.02` changed the selected member. Exact paired replays used the recorded S1 runtime and verified the historical prefix. One source series was a 2-0 win and the other a 0-2 loss; both remained unchanged after the lineup substitution, with zero season-level points, rank, title, cash, contract, and payroll deltas. These are real treatment contrasts but competitively neutral outcomes, supporting impact-calibration failure rather than a claim that the original ranking could not be crossed.

Each paired run was reduced from hundreds of megabytes to a roughly 25 KB verified causal capsule containing branch season summaries, the intervention record, runtime references, conclusions, and state hashes.

### Battle causal signature

The first phase reran the manager-06 Muk-to-Tauros case before deleting its branches. Both side-swapped games exposed the treatment immediately: Muk and Tauros each participated, the lead differed at turn zero, and the subsequent action paths did not behaviorally reconverge. The control used Muk, Poison Terastallization, and Focus Punch; the experiment used Tauros, Normal Terastallization, Close Combat, and Giga Impact. Both games took two additional turns in the experiment, with different switch, move, damage, healing, and faint-event totals, but the same manager won both branches.

This is classified as `trajectory-change-outcome-neutral`, not `unused-substitution`. The compact signature retains team delta, participation, first divergent turn, a three-turn action window, reconvergence status, event totals, and branch outcomes. Timestamps, debug lines, complete logs, and raw AI traces are excluded.

## Stratified lineup pilot

The second phase builds a deterministic 30-case plan from the compressed diagnosis. It balances early, middle, and late seasons; original wins, losses, and draws; low, medium, and high style perturbations; and razor, close, and wide decision margins. Manager and season caps prevent a prolific manager or one unusual season from dominating the evidence.

`run` is resumable and fail-fast. It refreshes all selected traces from an execution season together, reuses the immutable official checkpoint as the control branch, runs only the experimental branch, verifies the historical prefix and intervention, creates a battle causal signature, then deletes the branch after writing a gzip capsule. `--max-cases` bounds one invocation without changing the 30-case plan. Existing refreshed seasons are consumed first.

The first real gate case used manager-10 in season 17. Both side-swapped games diverged at the action level and used the substituted member, but neither winner changed.

### Completed stratified result

The formal plan completed all 30 manager-unique samples across 12 seasons with no failed run. Era, perturbation, and decision-margin coverage were each exactly 10/10/10; original source outcomes were 10 wins, 11 losses, and nine draws. All 60 side-swapped games changed action trajectories, no substituted member went unused, and 20 games changed winner.

At the independent manager level, seven alternatives improved the local series, 15 were neutral, and eight regressed. The paired score was `0.483333`; exact one-sided improvement and regression probabilities were `0.696381` and `0.500000`. The result is `keep-shadow-no-clear-benefit`: bounded rescoring reliably changes behavior, but it does not improve competitive outcomes. The current lineup policy remains authoritative, and repeating more samples from the same mechanism is not the next priority.

## Promotion review

The third phase is a read-only promotion gate. It verifies each compressed capsule against the plan, manifest, immutable target-season hash, intervention identity, historical prefix, and battle causal signature. A later continuation of the source dynasty may change the source-head hash without invalidating an already sealed season; that condition is reported separately from target-season drift.

The default gate requires at least 24 completed samples, 20 independent managers, nine seasons, balanced era/source-outcome/perturbation/margin coverage, at least 90% behavior expression, and eight outcome-changing manager samples. Side-swapped games prove that the treatment acted but never count as independent observations. Exact one-sided sign tests detect improvement and regression. Possible conclusions are integrity block, insufficient evidence, no observed impact, regression rejection, low impact, no clear benefit, or `candidate-for-scoped-assist-review`.

The command cannot activate league behavior or issue a production approval. Even the strongest conclusion is review-only and would require a separately designed scope artifact and live safety gate.

## Mechanism discovery

The completed 30-manager pilot was also analyzed feature by feature with independent manager-season signs and Benjamini-Hochberg correction. None of the 13 scored contributions was eligible for promotion. `lineup.structure` and `lineup.synergy` were constant across every treatment contrast, while aggregate opponent coverage and counter preference more often moved opposite the winning branch. Role-target coverage was directionally promising but appeared in too few seasons to establish a reliable effect.

The resulting conclusion is `requires-new-feature-representation`, not a request to tune existing weights. Repeating the same aggregate scores would create more observations without creating the missing distinctions.

## Lineup representation v2

### Personal-evidence opportunity allocation

The effective-speed-pressure causal study was the first plan allocated with manager-personal mechanism ledgers. A minimum-cost constrained allocator preserved exact season and source-outcome strata, guardrails, treatment strength, and manager uniqueness while preferring managers with fewer prior experiments. Both previously unobserved managers received a legal case. All 24 cases completed, all 48 games expressed an action divergence, and no substitution was unused.

The manager-level result was one improvement, 18 neutral outcomes, and five regressions (`pairedScore=0.416667`, improvement `p=0.984375`, regression `p=0.109375`). This is `no-clear-benefit`: combining speed with offensive pressure still does not justify a league-wide preference. Manager 23 retains one positive local observation; managers 02, 10, 17, 27, and 29 retain one negative local observation. Every one remains `exploring` because a single experiment cannot establish a personal rule.

After automatic ingestion, all 30 managers have personal evidence. Population concentration fell from `gini=0.177778` to `0.129630`; attempt counts are now 1 minimum, 2 median, and 3 maximum. The allocator changed experimental opportunity only and never modified formal lineup behavior.

New lineup traces therefore carry a separate `diagnostics` map. It records structural role redundancy and single points, strength floor and spread, member-coverage dispersion, and the minimum, mean, and dispersion of answer depth for each opposing roster member. These descriptors are copied into compact shadow summaries but contribute exactly zero to rational, style, and final scores.

This is intentionally prospective telemetry. Historical compact capsules cannot be losslessly backfilled because they did not retain each candidate member's per-opponent coverage vector. Future evidence may determine which descriptors matter, in which environments, and in what direction; the implementation does not predeclare that redundancy or coverage depth is always desirable.

Mechanism discovery reads these fields under a `diagnostic:` namespace alongside scored contributions. They receive the same independent-manager, season-coverage, exact sign, and multiple-comparison checks, while remaining visibly distinct from active policy features.

The representation-readiness command scans season decision ledgers only, never battle logs. It reports telemetry coverage and cross-candidate variance, and requires 60 traces, 20 managers, three seasons, 20 variable contrasts, and four variable descriptors before declaring the data ready for outcome linkage. This gate is about observability, not policy quality.

The accumulation-efficiency command creates a temporary one-season continuation from the latest immutable boundary, runs it with the current code, measures diagnostic yield, variance, runtime, and storage, verifies the source state hash, and removes the temporary league. Only its compact benchmark report is retained.

With `--seasons 3`, the accumulation command also retains a compressed outcome-linked study set while deleting the full temporary league. The outcome-review command pairs winning and losing incumbent lineups, uses a deterministic set of manager-disjoint series for its primary exact-sign screen, applies multiple-comparison correction, and treats all remaining series as descriptive stability evidence. Its candidates authorize only a later causal intervention study.

### First prospective result

The S22-S24 temporary continuation produced 2,238 diagnostic traces, 2,230 variable candidate contrasts, all 30 managers, all three seasons, and 14 variable descriptors. Runtime was about 9.2 minutes. The deleted full branch occupied 1.67 GB; the retained outcome-linked sample archive is about 328 KB.

The first outcome review paired 1,100 decisive series and reserved 15 series covering 30 manager-unique participants for the primary screen. No descriptor passed the independent-manager exact-sign and adjusted-significance gates. Full-sample winner-higher rates mostly ranged from 46% to 57%, and some directions reversed in the independent sample. The result is `no-reliable-association`: the representation is now observable and reviewable, but it does not yet justify a diagnostic-based lineup policy or causal intervention target.

## Lineup representation v3

The next prospective representation adds battle-mechanism telemetry without changing lineup scores. It records speed floor, median, spread, and relative speed advantage. Per-opponent offensive pressure uses move power, category, STAB, type effectiveness, and the relevant attack/defense base stats; defensive safety applies the same proxy in reverse. Team descriptors retain the best and second-best offensive and defensive answers, plus a worst two-way matchup floor.

These are bounded matchup proxies rather than exact damage calculations. Abilities, items, field state, setup, status, and move-specific exceptions remain outside the proxy, so outcome review must determine whether the extra detail is useful.

### First v3 result

The S22-S24 v3 continuation retained 2,238 traces and 26 descriptors, 25 of which varied across candidates. A manager-disjoint 15-series screen remained underpowered, so the review added a pre-policy within-manager residual screen: each manager's long-run descriptor mean is removed, then 1,106 decisive series are evaluated with deterministic series-level outcome permutations and multiple-comparison correction.

Five exploratory associations passed that screen. Relative speed advantage was strongest (`effect=0.168849`, `q=0.0065`), followed by lineup strength floor (`0.138855`, `q=0.0065`), role-tag breadth (`0.085848`, `q=0.033784`), speed spread (`0.084012`, `q=0.033784`), and speed median (`0.083140`, `q=0.033784`). These authorize a predeclared causal lineup intervention study; they do not authorize policy weights.

The first causal plan contains 24 manager-unique interventions, balanced at eight per season across S22-S24 and 12 source wins/12 source losses. Every candidate increases relative speed advantage while limiting strength-floor regression to five points and role-breadth regression to one tag. The existing lineup counterfactual runner now supports an exact `--candidate-id` intervention, so this study does not depend on manipulating unrelated style weights.

### Completed speed intervention result

All 24 predeclared manager-unique interventions completed without a technical failure. The forced candidate changed the battle action path in 46 of 48 side-swapped games and changed six game outcomes, so the treatment was expressed rather than silently ignored. Two substitutions went unused.

No manager improved: 21 local series were neutral and three regressed. The paired score was `0.4375`; the one-sided improvement probability was `1.0`, while the regression probability was `0.125`. The result is `no-clear-benefit`. Relative speed advantage remains useful telemetry, but increasing it alone is not a justified lineup objective and no live policy weight is activated.

The resumable runner preserves only compact evidence capsules after each case. The 24-case retained study is about 0.83 MB; its 1.84 GB temporary prospective source is removed on completion. Completed-run recovery is idempotent and performs summary/cleanup only, without rebuilding the source.

## Hypothesis workbench

The lineup hypothesis registry separates domain-informed questions from manager preferences. Each entry declares a rationale, percentile-normalized factors, direction, machine-readable guardrails, lifecycle stage, and any completed causal evidence. Registry entries and audit results are always `shadow-only`; neither can alter lineup scores.

The first workbench audit evaluated six predeclared mechanisms over 2,238 observations and 1,106 decisive S22-S24 series. It applies within-manager residualization, deterministic outcome permutations, and Benjamini-Hochberg correction to the composite scores. Previously completed causal evidence takes precedence over a renewed observational association: raw speed remained associated with winners but retained its completed `no-clear-benefit` verdict.

Three new combinations passed observational screening. Role compression with a viable strength floor was strongest (`effect=0.166884`, `q=0.001`), followed by effective speed pressure (`0.148234`, `q=0.001`) and safe two-way speed pressure (`0.079074`, `q=0.008996`). Answer redundancy and no-blind-spot resilience did not pass. These are causal-planning candidates, not AI preferences.

The role-compression planner found 196 guarded alternatives and predeclared 24 manager-unique interventions, balanced at eight per season and 12 source wins/12 source losses. The runner can execute this generic plan through the same exact-candidate, side-swapped, compact-capsule pipeline used by the completed speed study.

The completed role-compression study found three improvements, 18 neutral series, and three regressions across 24 manager-unique interventions. All three improvements came from source losses; all three regressions came from source wins. The paired score was `0.5`, with equal one-sided improvement and regression probabilities of `0.65625`. Fifty games produced 48 action divergences and 12 outcome changes, establishing behavioral expression but `no-clear-benefit`. The hypothesis is now `causal-complete` and cannot be rescheduled merely because its observational association remains strong.
