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

No program is activated from this probe. Formal activation still requires a resumable cross-seed sampler, paired aggregation, sufficient outcome-changing seed clusters, and an explicit promotion review. V12 audit emits `program-behavior-collapse` when program evolution is enabled for at least three seasons but every active manager still has the same behavior fingerprint.
