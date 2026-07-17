# Tactical memory ablation

This experiment measures whether the opponent model already used by battle search improves competitive outcomes. It does not ask whether memory is populated correctly; the existing white-box replay covers that mechanical contract.

## Paired design

One sample is one retained battle and one acting side. Both branches keep the packed teams, tactical profiles, opposing AI, battle rules, and exact four-word Showdown seed fixed.

- `learned`: exact replay with both retained opponent models.
- `ablated`: exact replay with only the acting side's opponent model reset to the empty prior.

The learned branch must reproduce the retained decision trace byte-for-byte after JSON parsing. Full source traces may be plain `ai-decisions.json` or compact-retention `ai-decisions.json.gz`. A replay capsule without a full trace is excluded during planning.

Turn count is audit context, not reward. Each side receives 1/0.5/0 for win/draw/loss. Significance is calculated from the direction of exact-seed cluster means, so two sides or repeated samples from one battle seed do not become independent evidence.

Formal review defaults to at least 30 side-pairs, 10 exact-seed clusters, 10 outcome-changing pairs, 5 directional clusters, and a one-sided exact-binomial result at or below 0.10. Possible conclusions are `supported`, `harmful-review`, `no-observed-outcome-effect`, `no-clear-benefit`, `insufficient-evidence`, and `blocked`. No conclusion changes runtime behavior automatically.

## Local sampler

Planning launches no battles:

```powershell
npm run sample:tactical-memory-ablation -- `
  --inputs output/league `
  --out output/tactical-memory-ablation
```

Run a bounded batch explicitly:

```powershell
npm run sample:tactical-memory-ablation -- `
  --inputs output/league `
  --out output/tactical-memory-ablation `
  --run `
  --max-launches 10 `
  --max-samples 90 `
  --min-free-gb 10
```

`--max-samples` and `--max-launches` are runtime budgets and may be raised on resume. Identity-bearing settings, source capsules, and the candidate catalog remain manifest-bound. `--minimum-confidence` and `--maximum-confidence` select a half-open confidence interval, except the default upper bound includes 1.

Use `--existing <prior-output>` to reference verified completed samples from another compatible hypothesis. Branch directories are not copied. The new manifest records their origin and revalidates candidate identity, capsule SHA-256, sample identity, and exact-source verification. `--exhaust-source-pool` is an explicit diagnostic override that continues after a formal terminal conclusion; it should be reported as an exploratory source-pool census rather than a fresh confirmatory test.

## V14 calibration result

The isolated nine-season, six-manager V14 journey provided 168 full-trace candidates across 56 exact battle seeds after compact-only sources were excluded.

The broad sequential review stopped at 93 samples when it reached 10 outcome-changing pairs:

- decision divergences: 46/93;
- learned better/neutral/worse: 4/83/6;
- mean learned score delta: -0.0215;
- seed-cluster improvement/regression p: 0.8906/0.3438;
- conclusion: `no-clear-benefit`.

The complete low-confidence `[0.05, 0.15)` source-pool census reused 69 samples and executed the remaining 69:

- samples/seeds: 138/54;
- decision divergences: 66;
- learned better/neutral/worse: 5/122/11;
- mean learned score delta: -0.0435;
- better/neutral/worse seed clusters: 2/47/5;
- regression p: 0.2266;
- conclusion: `no-clear-benefit`.

The complete confidence `>= 0.15` pool reused 24 samples and executed 6:

- samples/seeds: 30/14;
- decision divergences: 17;
- learned better/neutral/worse: 1/29/0;
- mean learned score delta: +0.0333;
- conclusion: `insufficient-evidence` because only one pair changed the outcome.

The calibration established that the opponent model is behaviorally material, but it did not justify changing runtime behavior. It selected `.15` as a prospective confidence-floor hypothesis for a separately seeded holdout; no calibration result was reused as confirmatory evidence.

## Independent confidence-floor holdout

Three new nine-season, six-manager journeys used seeds `holdout-memory-a`, `holdout-memory-b`, and `holdout-memory-c`. They ran the unchanged cumulative-memory policy with no confidence floor and produced 240 eligible low-confidence side-pairs across 108 exact Showdown seeds. The manifest and all thresholds were locked before replay.

Sequential review stopped as soon as the predeclared competitive gate was reached:

- samples/seeds: 138/108;
- decision divergences: 56/138;
- learned better/neutral/worse: 1/128/9;
- decisive pairs and seed clusters: 10/10;
- mean learned score delta: -0.0580;
- seed-cluster improvement/regression p: 0.9990/0.0107;
- conclusion: `harmful-review`.

The reviewed policy change is to retain all observations but set the battle opponent-model confidence to zero until its computed confidence reaches `.15`. Counts, episodes, posterior learning, lineup memory, and later confidence growth are not deleted or delayed. New V3/V4/V12 journeys default to this floor; `V12_TACTICAL_MEMORY_CONFIDENCE_FLOOR=0` reproduces the prior behavior. Saved journeys bind the setting and cannot silently resume under another floor.

Seasonal behavior-count decay is implemented only as an isolated experiment setting (`V12_TACTICAL_MEMORY_BEHAVIOR_POLICY=seasonal-decay`). It remains inactive by default because the confidence-floor holdout does not test recency weighting.

## Seasonal-decay shadow experiment

New journeys maintain two tactical behavior memories from the same observed episodes: `cumulative` and `seasonal-decay`. The active policy remains manifest-bound in the dynasty settings. Both shadow memories are deep-cloned with the manager profile, audited against the active memory when their policies match, and saved in the dynasty checkpoint. Existing journeys can begin shadow collection on resume, but their `startedSeason` marks them as warm-start evidence rather than full-history evidence.

From the second season onward, each battle replay capsule may contain compact, named opponent-model shadows for the two participating managers. These models are evidence only; `runBattle` still constructs both live AI contexts exclusively from `aiOpponentModels`. The capsule also records `aiOpponentModelPolicy`, so a sampler cannot mistake a seasonal-decay source for a cumulative incumbent.

Plan or run an exact one-side comparison:

```powershell
npm run sample:tactical-memory-ablation -- `
  --inputs output/holdout-a,output/holdout-b `
  --out output/seasonal-decay-holdout `
  --shadow-policy seasonal-decay `
  --minimum-confidence 0 `
  --run
```

The sampler excludes capsules without the requested shadow, non-cumulative incumbents, unchanged acting-side models, incomplete traces, active battle assists, or incompatible AI versions. The incumbent must reproduce the retained decision trace exactly. The candidate branch then replaces only the acting side's model; teams, opposing AI, active opponent model on the other side, tactical profiles, battle rules, and Showdown seed remain fixed. Candidate identity includes the shadow policy, and manifests lock that policy across resume.

The four-season workflow probe produced four distinct candidates across two seeds. Three bounded paired replays completed with exact source verification and no failures. They had no decision or outcome divergence, which validates plumbing only and is not competitive evidence. Formal review still requires independently seeded journeys and the normal decisive-pair gate.
