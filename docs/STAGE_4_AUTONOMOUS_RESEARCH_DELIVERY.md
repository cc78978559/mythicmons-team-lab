# Stage 4 Delivery: Autonomous Research

## Evaluation

The existing research agenda system lets managers choose among centrally registered hypotheses. Its exploration parameter can evolve, but managers cannot derive a new question from their own program, convert it into an executable experiment, or remember that a technically invalid source is unusable. Exact battle counterfactual tooling already existed, but required a human-authored plan.

Stage 3 supplied 30 distinct conditional programs and 10,516 paired decisions. Of those decisions, 2,776 have at least one legal reasonable alternative, giving Stage 4 a sufficiently broad local experimental frontier.

## Design

Each manager now maintains a signed research state separate from battle policy. It generates questions from its own V2 rules, ranks them under a common information objective, and selects one executable question per round. Managers begin with no research-style distinction. Different research paths emerge from their programs and results.

The planner maps questions to exact action interventions without looking at future results. Assignment is scarcity-aware and population-wide. It freezes 180 unique intervention identities across six rounds. Support causes replication, contradiction causes boundary resolution, and neutral evidence causes neutral-boundary mapping.

Experiments use exact incumbent and intervention branches. Source replay, decision prefix, and intervention application are mandatory. The evidence authority is `exact-counterfactual-single-environment`: stronger than observational Stage-3 credit, but below independent multi-environment activation evidence.

## Tooling Optimization

Implementation review found and fixed four defects before delivery:

1. Feasibility normalization could exceed one when a rule had more than 64 cases. Validation stopped the first plan before execution.
2. Some retained sources cannot reproduce their original trace. The runner now preregisters fallback cases and separates technical failure from competitive outcome.
3. Fallbacks initially stayed inside one question, which could strand a manager when one source class was unreplayable. Fallbacks now cross the manager's ranked questions while preserving actual-question attribution.
4. Intervention deduplication initially checked only a decision's default alternative. One duplicate in a rejected four-round baseline exposed the flaw. Delivered deduplication binds source, decision, side, and actual forced action. Technical failures also enter a cross-round blacklist.

Source verification hashes 180 unique battles rather than 2,776 frontier rows. Full source doctor takes about 3 seconds. A completed six-round request returns from cache in about 63 milliseconds.

## Execution

The final clean run used 30 managers, six rounds, four local workers, and 180 unique exact interventions. It completed in 83.8 seconds with peak RSS around 390 MB. Compact retained output is about 1 MB, and no temporary replay directory remains.

- 146 first tests of program mechanisms
- 18 neutral-boundary studies
- 14 contradiction-resolution studies
- 2 support replications
- 22 managers changed research intent after evidence
- 14 better, 152 neutral, and 14 worse intervention outcomes
- 18 results supported the program hypothesis
- 10 non-neutral results contradicted it
- 135 branches changed some observable outcome or duration
- 180 independent cases and zero duplicate interventions

Ten unique source cases failed exact replay. Nine managers switched to a preregistered fallback; one manager required two failed candidates before a later fallback succeeded. No failed case was retried in a later round and none entered competitive statistics.

Manager 07 illustrates the intended behavior. It first found support for hazard and switching questions, explored two other mechanisms, then returned to replicate its switching result. The replication contradicted the original result, so round six changed to contradiction resolution rather than silently retaining the favorable belief.

## Review

Stage 4 is delivered. The AI population can now generate questions from personal programs, select experiments, execute exact counterfactuals, distinguish technical failure from evidence, avoid duplicate work, and adapt future research intent.

The high neutral rate is informative rather than a failure: most isolated reasonable alternatives do not change the winner in one fixed environment. These results justify research direction changes, not program activation. Formal takeover still requires independent seeds or environments, aggregated causal effects, and a current-era activation gate.
