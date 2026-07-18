# Strategy program evolution

Strategy programs are bounded expression trees with five entrypoints: acquisition, configuration, lineup, battle, and learning. They supplement manager traits and genomes; they do not replace legality checks, roster constraints, or the battle engine.

## Semantic mutation

Each entrypoint now has an explicit input vocabulary matching the values supplied by its live call sites. A mutation cannot attach a learning-only variable to acquisition or a battle-only variable to configuration. The mutation operator retries up to eight deterministic alternatives and declares `program.semantic-noop` if none changes behavior.

Behavior is measured on a fixed, entrypoint-specific probe matrix. The fingerprint contains 15 bounded outputs, a SHA-256, non-zero count, and output range. Behavioral distance is the normalized mean absolute difference between two fingerprints. It is used for:

- rejecting structural mutations that are semantic no-ops;
- manager personality similarity;
- punctuated-evolution candidate evidence and bounded novelty scoring;
- white-box parent-to-child mutation traces;
- V12 active-population audits.

The fingerprint measures whether two programs behave differently. It does not prescribe which behavior is competitively correct.

## Shadow candidates

Punctuated evolution remains `shadow` by default. A shadow season may retain at most the bounded burst winners in `evolution-shadow-candidates.json`. Each source-bound candidate includes its complete profile, lineage, replaced lineage, registry hash, ecological fitness, and program behavior distance. Discarded cheap candidates remain compact summaries in `evolution.json`.

`counterfactual:shadow-program` loads one semantic candidate and creates two thin local branches from the exact completed dynasty:

- experiment: inject only the candidate `strategyProgram` into the target manager's otherwise unchanged parent profile;
- control: retain the complete parent profile.

Both branches resume one season under the saved league settings. Prior season files are hard-linked when supported and copied otherwise. The tool verifies the immutable prefix, source seed, registry hash, manager slot, replaced lineage, candidate birth season, and non-zero program behavior distance. Other candidate mutations are deliberately excluded, so the reported points, rank, title, and cash deltas isolate the strategy program.

```powershell
npm run counterfactual:shadow-program -- `
  --source output/league `
  --out output/program-counterfactual
```

## Current evidence

A four-season, six-manager forced-burst probe generated 48 cheap candidates:

- 32 changed strategy-program behavior;
- 0 declared program mutations were semantic no-ops;
- each candidate season contained multiple structural and behavioral fingerprints;
- four of six retained burst winners had a semantic program change.

The first exact program-only continuation replaced one manager's zero program with a candidate at behavior distance `0.0125`. The full four-season prefix matched, both fifth-season branches completed, and points, rank, titles, and cash were unchanged. This validates the causal workflow only.

No program is activated from this probe. Formal activation requires evidence from the cross-seed sampler below, sufficient outcome-changing seed clusters, and an explicit promotion review. V12 audit emits `program-behavior-collapse` when program evolution is enabled for at least three seasons but every active manager still has the same behavior fingerprint.

## Cross-seed sampler

`sample:strategy-program-evolution` implements that evidence loop locally. For each independent seed it advances a small shadow league one season at a time, stops at the first season containing semantic shadow winners, chooses one eligible manager by a seed hash rather than effect size, and runs the exact program-only counterfactual. A seed with no semantic winner inside the configured horizon is recorded as `no-candidate`, not as a failed or neutral experiment.

```powershell
npm run sample:strategy-program-evolution -- --run `
  --out output/strategy-program-evidence `
  --target-samples 10 `
  --minimum-seeds 10
```

The manifest is saved before and after every seed. A process interrupted while a seed is `running` removes only that unverified seed directory and restarts it; validated seeds are never repeated. `--retry-failed` explicitly retries failed seeds. The default `audit-summary` retention removes battle, roster, career, and configuration bulk after the counterfactual summary is complete. A three-seed workflow probe removed `41.92 MB` and retained about `50.1 MB`.

The counterfactual summary records three distinct effect layers before compaction:

- program contribution values changed;
- management selections changed, including record-set divergence;
- battle choices changed, including post-divergence record-set changes.

Full AI decision tracing is enabled only for the paired continuation season and immediately compacted. This distinguishes a program that executes without crossing a choice boundary from one that actually changes play, without requiring later review of turn-by-turn logs.

The formal gate cannot be weakened below ten paired independent seeds by requesting a smaller workflow target. It also requires at least four outcome-changing pairs and four directional seed clusters, one-sided evidence at `p <= .1`, and non-negative mean points and titles. Passing produces only `candidate-for-bounded-active-review`; the sampler never edits production policy. Different seeds produce different programs, so this gate evaluates the bounded shadow-winner program operator, not a universal fixed strategy.

The first three-seed telemetry probe found semantic winners in all three seeds and compared `372` target-manager battle choices. One program changed three recorded program-contribution values; none changed a management selection, battle choice, points, rank, title, or cash outcome. The result is `insufficient-evidence`, not activation evidence. This indicates that the next evolutionary improvement should reward opportunity-adjusted behavioral expression before spending the full formal sample budget; the sampler and its gate remain ready for that later hypothesis.
