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

Both branches resume for the same two-season evaluation horizon under the saved league settings. Two seasons are required because a learning entrypoint first changes memory at the end of its activation season and can influence configuration only in the following season. Prior season files are hard-linked when supported and copied otherwise. The tool verifies the immutable prefix, source seed, registry hash, manager slot, replaced lineage, candidate birth season, and non-zero program behavior distance. Other candidate mutations are deliberately excluded, so cumulative points, final rank, title, and cash deltas isolate the strategy program.

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

The manifest is saved before and after every seed. A process interrupted while a seed is `running` removes only that unverified seed directory and restarts it; validated seeds are never repeated. `--retry-failed` explicitly retries failed seeds. A completed batch may increase `--target-samples` and `--minimum-seeds` in place while every simulation setting remains identical, so extending evidence does not recompute validated seeds. Targets cannot decrease. The default `audit-summary` retention removes battle, roster, career, and configuration bulk after the counterfactual summary is complete. A three-seed workflow probe removed `41.92 MB` and retained about `50.1 MB`.

The counterfactual summary records three distinct effect layers before compaction:

- program contribution values changed;
- management selections changed, including record-set divergence;
- battle choices changed, including post-divergence record-set changes.

Full AI decision tracing is enabled only for the paired continuation season and immediately compacted. This distinguishes a program that executes without crossing a choice boundary from one that actually changes play, without requiring later review of turn-by-turn logs.

The formal gate cannot be weakened below ten paired independent seeds by requesting a smaller workflow target. It also requires at least four outcome-changing pairs and four directional seed clusters, one-sided evidence at `p <= .1`, and non-negative mean points and titles. Passing produces only `candidate-for-bounded-active-review`; the sampler never edits production policy. Different seeds produce different programs, so this gate evaluates the bounded shadow-winner program operator, not a universal fixed strategy.

The first three-seed telemetry probe found semantic winners in all three seeds and compared `372` target-manager battle choices. One program changed three recorded program-contribution values; none changed a management selection, battle choice, points, rank, title, or cash outcome. The result was `insufficient-evidence`, not activation evidence.

## Opportunity-adjusted expression

The league now records bounded real-context opportunities for acquisition, configuration, lineup, battle, and learning programs. Each manager-entrypoint pair retains at most 24 deterministic min-hash input samples plus its total observation count. This avoids both an artificial hand-written target style and unbounded candidate logs. A six-manager season uses about `130 KB`; a linear 30-manager, nine-season estimate is about `5.8 MB`.

Punctuated evolution keeps two separate winners from the same cheap candidate population:

- the complete descendant winner remains selected by ecological fitness, bounded mutation novelty, and fixed-probe program behavior;
- the program-only shadow winner is selected by historical choice-boundary potential, then real-context expression distance and ecological fitness.

Choice-boundary potential is direction-free. Acquisition, configuration, and lineup programs are scored by pairwise ordering changes over retained real contexts. Battle programs use the magnitude of tactical-parameter change, while learning programs use variation in evidence adjustment. A monotonic program such as `new score = old score * 1.15` can have a large numerical distance but zero ordering potential and is excluded from the program-only shadow package.

On the same three seeds, opportunity distance first raised observed program-signal changes from `1/3` to `3/3`, but all selected programs merely scaled acquisition baselines. Adding choice-boundary filtering replaced them with speed, roster-size, and learning-evidence programs with predicted historical choice potential of about `0.34%` to `0.50%`. Two of three changed recorded program signals, but none changed a realized management or battle choice in the next season.

The candidate generator now also places symmetric branches at intervals between retained real observations. Feature, threshold interval, direction, and amplitude are seed-selected, so this raises expression probability without defining what a manager ought to prefer. In the first three paired seeds, one lineup threshold changed program signals without changing the selected lineup, one battle threshold did not recur in the continuation context, and one battle threshold changed `14` of `178` compared battle choices. Competitive outcomes remained neutral in all three.

A frozen ten-seed one-season diagnostic then produced decision divergence in `6/10` samples: all three battle programs, both configuration programs, and one of two acquisition programs changed observed choices or record sets. It produced one competitively better, one worse, and eight neutral pairs, with mean point delta `0`. Both learning programs appeared inert, exposing a horizon error rather than an operator failure. Replaying the first three seeds over two seasons made the same learning mutation progress from zero observed differences in season one to `29` battle-choice differences over the full horizon; the lineup mutation remained non-decisive, so the longer window does not automatically manufacture an effect.

The active hypothesis is therefore `observed-boundary-two-season-program-operator-v1`; all one-season samples are diagnostic history and cannot be mixed into its activation evidence. The two-season batch was extended in place from ten to twenty independent seeds without recomputing validated samples. At twenty seeds, `13/20` changed an observed decision or record set, with four competitively better, two worse, and fourteen neutral pairs. Mean points, rank improvement, and title deltas were `+0.3`, `+0.15`, and `+0.1`, but the one-sided improvement probability was only `0.34375`. The formal conclusion is `no-clear-benefit`, not an activation candidate. Counterfactual summaries retain evaluation horizon and exact operator mutations after bulk evidence is compacted. Production remains shadow.
