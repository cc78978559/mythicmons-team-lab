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

Battle evidence is scanned only where full `ai-decisions.json` traces were retained. A source with compact-only battle summaries is marked `battleEvidence: not-retained`; an older trace without white-box fields is marked `legacy-without-whitebox`. Neither state is evidence of agreement.

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
The unified runner executes gate-approved lineup replicas and exact battle replicas through separate isolated routes. Battle branches retain only their two games and summary rather than using dynasty-directory compaction. Their multi-sample results use the battle-specific paired aggregate above. Learning, memory, and evolution interventions remain unsupported.
