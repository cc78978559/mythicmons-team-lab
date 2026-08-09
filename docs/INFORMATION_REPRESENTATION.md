# Structural Information Representation

The position-value and manager-program stages now combine dynamic battle state with public pre-battle team structure. The representation supplies observable questions to learning; it does not encode a preferred play style or manually reward any feature direction.

## Structural Features

- `roleBreadthDelta`: coverage of hazards, removal, recovery, pivoting, setup, priority, screens, status, physical pressure, and special pressure.
- `roleCompressionDelta`: utility roles carried together by the same team members.
- `structuralSinglePointDelta`: key roles that rely on exactly one member.
- `answerRedundancyDelta`: strength of the second-best offensive answer to the opponent's members.
- `blindSpotResilienceDelta`: strength of the weakest best answer across the opposing team.
- `opponentStructureResponseDelta`: utility-role-weighted response quality against the opponent's structural members.
- `opponentStructureLoadDelta`: concentration gap between the best and second-best answers to those structural members.

All values come from open team sheets before the decision. They exclude the selected action, candidate scores, manager personality, terminal outcome, and hidden battle state. Paired features are perspective-symmetric.

## Acceptance Contract

Stage 2 blocks missing, constant, or duplicate structural columns. It reports ranges, distinct columns, maximum absolute inter-feature correlation, and pairs above `0.995`. The structural model is evaluated against an untouched 12-feature model on the same battle-cluster split, so improvement cannot be attributed to an easier holdout.

Stage 3 reports how many learned predicates, managers, features, and action targets actually use structural context. Adoption is evidence-driven: a manager may ignore any structural feature when its discovery and validation partitions do not support it.

## Current Baseline

- Corpus: 180 battles, 10,516 decisions, 45 team clusters.
- Structure contract: 7/7 varying and distinct columns; maximum absolute correlation `0.845850`.
- Stage-2 held-out log loss: `0.467882`, improving `4.107410%` over the untouched 12-feature model.
- Stage-2 bootstrap probability of beating the legacy model: `0.776`.
- Stage 3: 71 accepted structural predicates across 27/30 managers, using all 7 features and 4 action targets.
- Stage-3 held-out MSE improvement over novice programs: `9.700578%`; 30 managers improved and none regressed.

These results establish useful information representation, not formal decision authority. Stage 2 and Stage 3 remain shadow-only; causal research and formal validation retain their separate gates.
