# Stage 2 Delivery: Position Value

## Evaluation

The existing battle candidate scores estimate heuristic consequences after a proposed action and combine expected, downside, worst-case, and personality terms. They are not action-independent position values. Historical traces also lack sufficient state snapshots, so they cannot safely train a win-probability model without reconstruction or leakage.

## Design

Stage 2 adds a signed pre-action state encoder and a symmetric logistic value model. Training labels are terminal or max-turn-adjudicated wins. Entire unordered team matchups are assigned to train, validation, or test, keeping seeds and swapped orientations together. Each battle side receives equal total weight, preventing long games from dominating.

An initial single-perspective model exposed a mean prediction of 0.383 against a balanced 0.5 outcome rate. Review traced this to asynchronous decision opportunities. The delivered v2.1 model uses same-turn paired perspectives and has a maximum numerical symmetry error below `1.5e-16`.

## Execution

The prospective current-policy corpus contains 180 completed battles across 45 unique team matchups, two seeds, and both orientations. It spans OU balance, stall, offense, weather, Trick Room, hazards, and four unrestricted archetypes. Generation completed with zero failures. Seven battles reached the 80-turn boundary and received the declared remaining-Pokemon-then-HP adjudication label.

The model used 10,516 paired samples. Matchup-level splitting produced 27/6/12 train/validation/test clusters and 108/24/48 battles. On the untouched test clusters:

- log loss: 0.488, versus 0.693 constant and 0.535 fixed material baseline
- Brier score: 0.160, versus 0.250 constant
- accuracy: 0.734
- expected calibration error: 0.053
- log-loss improvement: 29.61% over constant and 8.85% over material
- bootstrap probability of improvement: 1.000 over constant and 0.942 over material
- early/mid/late log loss: 0.522/0.492/0.244, versus material 0.571/0.511/0.437

All structural, calibration, sample-size, monotonic-material, phase, symmetry, signature, and source checks passed. Late-game results cover only three test clusters and should remain descriptive until the official holdout expands them. The signed model id is `51c7f0704678d0624f6eeefbe30577185bad029175812d8bcef7b12e5ee57a3f`.

## Efficiency

Corpus generation took about 40 seconds with four local workers. Training took about 11 seconds and peak RSS stayed below 190 MB. An unchanged rebuild verifies and reuses all 180 sources and the signed model in about 0.33 seconds. Samples and source cache together occupy less than 1 MB compressed.

## Review

Stage 2 is delivered as a reliable shadow value layer, not an action-selection authority. Its next use is to annotate current-era decision dossiers and localize whether an intervention improved the subsequent position before the terminal result. Official-league prospective evidence remains necessary before any control handoff.
