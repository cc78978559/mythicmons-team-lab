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

The current opponent model is therefore active and behaviorally material, but it is not yet competitively validated. Low-confidence memory has a negative observed direction without statistically sufficient regression evidence. Runtime remains unchanged. A confidence floor, recency weighting, or other memory-policy change requires an independently seeded holdout journey and must be tested as a new hypothesis rather than selected on this calibration set.
