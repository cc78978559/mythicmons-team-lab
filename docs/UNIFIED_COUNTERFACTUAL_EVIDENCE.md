# Unified counterfactual evidence

The unified evidence planner scans one or more audited dynasty roots without changing league behavior. It combines stored management, lineup, market, and retained battle shadow differences into one deduplicated, stratified catalog.

Repeated cases are split into two levels. A `hypothesis` is one stable domain, choice structure, classification, and contribution pattern. Its `replicas` retain the exact source root, seed, season, actor, review index, and replay route. Deduplication therefore reduces review noise without discarding independent experiments. At execution time, at most one replica per source seed contributes to a hypothesis.

```powershell
npm run counterfactual:whitebox-unified -- `
  --inputs output/official-era-02/league `
  --out output/official-unified-evidence `
  --max-cases 60 `
  --max-per-domain 10
```

Planning is the default. Cases are classified as:

- `executable`: an isolated replay runner and required gate already exist.
- `requires-gate`: evidence is useful, but the domain still needs a dedicated admission gate or replay route.
- `archive-only`: the stored difference is incomplete or unsupported for intervention.

Lineup hypotheses use the existing cautious assist scenario exactly: reasonable band `.5`, style limit `3`, and style scale `1.1`. The planner only re-scores traces that retained every lineup candidate. A scenario difference becomes executable only when the lineup assist gate approves its rational regression, net margin, structural coverage, and independent supporting signals. Compact/incomplete candidate traces are counted separately and never treated as agreements.

Run at most one admitted experiment explicitly:

```powershell
npm run counterfactual:whitebox-unified -- `
  --inputs output/official-era-02/league `
  --out output/official-unified-evidence `
  --run `
  --max-experiments 1 `
  --max-output-mb 1024 `
  --min-free-gb 20 `
  --activation-samples 30 `
  --activation-seeds 10
```

The manifest is resumable and configuration-bound. Completed branches are compacted with the existing audit-summary retention policy. Failed experiment directories are removed after the failure is recorded. The runner stops before launch when either the output budget or free-disk reserve is exhausted.

Completed experiments are aggregated separately for each hypothesis:

- fewer than 3 samples: workflow validation;
- 3–9 samples, or fewer than 5 seeds: preliminary evidence;
- at least 10 samples and 5 seeds: extended validation;
- at least 30 samples and 10 seeds: formal review eligibility.

Reaching the formal threshold never activates behavior automatically. A hypothesis must also have no fatal prefix/audit issue and must pass the paired competitive gate. The strongest output is `candidate-for-activation-review`, which still requires an explicit reviewed code or policy change.

Battle evidence is scanned where full `ai-decisions.json` or retained `ai-decisions.json.gz` traces exist. If both forms exist in one battle directory, the plain file wins and the trace is counted once. A source with compact-only battle summaries is marked `battleEvidence: not-retained`; an older trace without white-box fields is marked `legacy-without-whitebox`. Neither state is evidence of agreement.

New battles also retain a hash-verified `replay-input.json`. It contains the packed teams, exact four-word Showdown seed, normalized tactical profiles, normalized opponent models, AI version, and battle options. The battle runner can consume that exact seed without deriving it a second time. Decision traces carry a stable global ordinal, so repeated requests in one turn cannot be confused.

The isolated battle command is:

```powershell
npm run counterfactual:whitebox-battle -- `
  --source-game <battle-directory> `
  --out output/battle-counterfactual
```

It accepts only a white-box disagreement that passes the battle assist gate: a minimum rational gain, bounded final-score regression, and bounded combined downside/worst-case regression. It first proves that the incumbent battle reproduces the complete retained decision trace, then changes exactly one legal, reasonable candidate and proves that the branch prefix is identical. A missing capsule, hash mismatch, AI-version drift, target drift, or gate rejection stops the experiment. Ordinary league behavior remains unchanged.

Battle hypotheses are separated by the active species matchup and action family; unrelated move-to-switch situations are not pooled merely because their command shapes look alike. Aggregation scores only win/draw/loss from the acting side's perspective. Turn count is audit context, never a reward. Formal activation review requires 30 paired battles, 10 independent seeds, at least 10 outcome-changing pairs, at least 5 seed clusters with a directional mean effect, and a one-sided exact binomial result at or below `.10`. The binomial test operates on seed-cluster directions rather than individual battles, so several correlated battles from one seed cannot manufacture significance. A formal-size batch with zero changed outcomes stops as a no-benefit hypothesis instead of consuming samples indefinitely.

The targeted local sampler selects the replayable battle hypothesis with the broadest independent-seed coverage, unless `--hypothesis` pins one. It schedules one replica from every seed before taking a second replica from any seed, is resumable, and stops on disk limits, launch limits, terminal evidence, or a failed replay. Planning is the default and launches no battles:

```powershell
npm run counterfactual:whitebox-battle-sample -- `
  --inputs output/shadow-a,output/shadow-b `
  --out output/battle-sampler
```

If planning finds no gate-approved replayable disagreement, the sampler exits successfully and writes `battle-sampler-plan.json` plus a summary with `conclusion: no-eligible-hypothesis`. This is a valid negative result, not a runtime failure.

To produce independent shadow roots from one audited v14 replay capsule, use the bounded seed expander. It preserves teams, manager tactics, opponent models, and battle options while deriving a fresh Showdown seed per source and game. It rejects version drift and any source that already used active assist. Planning is again the default:

```powershell
npm run generate:whitebox-battle-sources -- `
  --source-game <battle-directory> `
  --out output/battle-shadow-sources `
  --seed-count 10 `
  --games-per-seed 3
```

Add `--run` to execute. `--max-launches`, `--max-output-mb`, and `--min-free-gb` bound local work. The manifest is configuration-bound, resumable after a clean budget stop, and fused after a recorded battle failure.

Run a bounded local batch explicitly:

```powershell
npm run counterfactual:whitebox-battle-sample -- `
  --inputs output/shadow-a,output/shadow-b `
  --out output/battle-sampler `
  --run `
  --max-launches 10 `
  --target-samples 30 `
  --minimum-seeds 10 `
  --max-samples 90 `
  --max-per-seed 9
```

This is the first unified layer. It does not weaken existing domain-specific gates.
The unified runner executes gate-approved lineup replicas, exact battle replicas, and named tactical-memory shadow replicas through separate isolated routes. Battle and memory branches retain only their two games and summary rather than using dynasty-directory compaction. Their multi-sample results use domain-specific paired aggregates.

Tactical-memory hypotheses compare the manifest-bound incumbent policy with one named retained shadow policy, such as `seasonal-decay`. Each replica is bound to the replay-capsule hash, exact Showdown seed, and one acting side. The runner first reproduces the complete incumbent trace, then replaces only that side's opponent model. At most one side from an exact seed contributes to a hypothesis, preventing correlated sides from inflating the independent-seed count. Formal evidence uses the same outcome-changing pair, directional seed-cluster, and exact-binomial gates as the standalone memory sampler. Reaching the threshold only creates an activation-review candidate.

The isolated memory command is also available directly:

```powershell
npm run counterfactual:tactical-memory -- `
  --source-game <battle-directory> `
  --player p1 `
  --candidate-policy seasonal-decay `
  --out output/tactical-memory-counterfactual
```

Cross-season personality learning is represented by a strict one-manager, one-season ablation. The candidate branch keeps season age, exploration decay, and style-history timing unchanged, but restores all six personality traits and all six strategy posteriors from the trace rollback payload. The incumbent branch must reproduce the stored source prefix, the candidate must match it through the intervention season, and exactly one experiment record must exist. Historical interventions only replay through the requested follow-up horizon, avoiding an unnecessary replay of every later archived season.

```powershell
npm run counterfactual:whitebox-learning -- `
  --source output/official-era-02/league `
  --manager manager-01 `
  --season 12 `
  --followup-seasons 1 `
  --out output/learning-counterfactual
```

The unified planner pools these replicas under the explicit `season-learning-v1` versus `no-learning` hypothesis, while allowing at most one intervention from each independent league seed. A favorable no-learning result is evidence against the current learning rule, not permission to disable learning automatically.

Evolution uses two source-bound routes. A current-season `evolution-shadow-candidates.json` package contributes only semantic strategy-program candidates with positive observed choice potential; these run through the existing two-season program-only counterfactual and the operator-specific aggregate. A full-personality candidate is executable only when the source dynasty genuinely contains a matching pending profile and lineage for the next season; it runs through the existing activation-versus-suppression replay. The planner never reconstructs discarded mutations or turns an ordinary shadow report into a synthetic candidate.

Both routes keep production evolution unchanged. Program evidence is grouped by mutation operator, while full-lineage evidence is stratified by its declared mutation structure. At most one replica per independent dynasty seed contributes to either hypothesis. A successful formal gate can only recommend bounded activation review.

## Scoped battle assist activation

There is no global battle-assist boolean. An activation-eligible aggregate can export a hash-verified approval containing only its proven matchup/action scopes:

```powershell
npm run release:whitebox-battle-assist -- `
  --evidence output/battle-sampler `
  --out output/battle-assist-approval.json
```

V12 accepts that artifact explicitly at a season boundary. Set it alongside the existing official season-cycle command and paths; do not start a separate default journey merely to activate assist:

```powershell
$env:V12_BATTLE_ASSIST_APPROVAL="output/battle-assist-approval.json"
npm run official-season-cycle -- <the existing audited journey arguments>
```

The league validates the artifact hash and AI version before starting. At runtime, an action changes only when its stable scope is present in the approval and the live assist gate still recommends it. A scope includes both active species, exact move families, and the target species of a switch. Every decision trace records scope matching, gate status, application status, and rejection reasons. Every replay capsule and battle ending records both the approved scope list and approval SHA-256. Sources produced under assist are excluded from shadow counterfactual sampling. Scoped-assist traces use AI version `stateful-choice-v14-scoped-assist-v1`; older battle capsules are deliberately ineligible rather than being silently reinterpreted. Continuing a journey across the v13-to-v14 code boundary still requires the existing one-time reviewed code-upgrade authorization; enabling a previously exported approval on unchanged v14 code does not.
