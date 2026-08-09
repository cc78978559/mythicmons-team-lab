# Stage 5 Delivery: Formal Validation

## Evaluation

Stage 4 completed 180 exact single-environment experiments. Sixteen clean supported rules remained after excluding rules with a non-neutral contradiction. They clustered naturally into four shared decision domains: hazard, physical attack, special attack, and switch. None had independent prospective evidence, so no rule could yet receive formal authority.

## Design

Stage 5 freezes shared domains rather than selecting isolated favorable rules after seeing results. The signed protocol binds every upstream artifact, the current formal evidence epoch, two environments, discovery exclusions, sample allocation, a one-battle-one-intervention rule, exact integrity requirements, and the statistical gate.

The outcome is terminal winner direction. Neutral branches remain neutral rather than being converted into weak support from turn count. Exact sign tests are corrected across the four frozen domains with Holm's method. A passing domain can only become eligible for a separately controlled canary; activation is never automatic.

## Tooling Optimization

The first diagnostic execution exposed two implementation issues before delivery. Four max-turn battles were initially treated as failed despite carrying the project's valid `remaining-pokemon-then-hp` adjudication. The source validator now accepts these signed terminal adjudications. Three planned cases then exposed the known class of exact replay failure. The delivered protocol preregisters one independent fallback per primary case, permits fallback only for technical failure, and reports attempts separately from unresolved failures.

The final source pool was expanded to two independent seed layers per environment. This supplied enough scarce hazard opportunities while preserving a unique battle for every primary and fallback reservation. Completed cycles reuse signed source manifests, the compressed frontier, plan, results, and case cache. Atomic post-run compression reduced the retained delivery archive from about 479 MB to 29.5 MB while preserving semantic source hashes and exact replay support.

## Execution

The clean delivery run generated 360 prospective formal-context battles and 5,587 executable frontier decisions. It reserved 192 unique battles for 96 primary cases plus one fallback each. All 96 primary experiment slots completed; one exact replay failed and selected its preregistered fallback. There were zero unresolved technical failures, duplicate battle uses, source drifts, prefix drifts, or Stage-4 source leaks.

The run completed in 93.3 seconds with peak RSS around 618 MB. Seventy-two branches changed an observable outcome or duration.

| Domain | Support | Contradiction | Neutral | Decisive | Result |
|---|---:|---:|---:|---:|---|
| Hazard | 2 | 2 | 20 | 4 | Inconclusive |
| Physical attack | 2 | 0 | 22 | 2 | Inconclusive |
| Special attack | 2 | 1 | 21 | 3 | Inconclusive |
| Switch | 4 | 2 | 18 | 6 | Inconclusive |

All Holm-adjusted p-values were 1.0. No domain was eligible for a limited canary.

## Review

Stage 5 is delivered as a working formal-validation system, not as a favorable verdict. The negative result is the important result: Stage-4 support did not reproduce strongly enough across fresh seeds and profile environments to justify policy control.

The switch domain reached the decisive-case floor and had a 4:2 aggregate direction, but the balanced environment was tied 1:1 and the corrected significance gate was not crossed. Physical attack had no contradictions but only two decisive cases. Hazard reproduced no net advantage. Special attack remained mildly positive but sparse.

The next evidence cycle should not weaken these gates. It should improve intervention informativeness or test narrower manager-selected boundaries prospectively, then submit a newly frozen family to the same validation system.
