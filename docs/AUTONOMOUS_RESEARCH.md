# Autonomous Research

Stage 4 lets each Manager Program V2 instance generate and pursue its own research questions. It replaces the old pattern in which managers could only rank hypotheses from a central registry.

## Question generation

Every question originates from one of the manager's own conditional program rules. The manager combines:

- uncertainty and support recorded on the rule;
- whether the rule has already been tested;
- prior support, contradiction, or neutral outcomes;
- the number of executable counterfactual cases;
- the rule's current program effect;
- bounded deterministic exploration.

These are universal research objectives, not authored battle preferences. No action family or feature receives a preferred weight.

Research intent changes from evidence:

- `test-program-mechanism` for an untested rule;
- `replicate-support` after a supportive result;
- `resolve-contradiction` after an opposing result;
- `map-neutral-boundary` after a neutral result.

## Exact experiments

The planner searches the Stage-3 paired-decision corpus for a context that satisfies the rule and has a legal, reasonable alternative from another action family. It freezes the source hashes, decision ordinal, side, turn, incumbent action, and intervention action.

Each experiment performs an exact incumbent replay and an intervention replay. It rejects the case unless the incumbent trace is reproduced, the pre-intervention prefix is identical, and the requested action is applied at the declared decision. Technical failures are never converted into neutral competitive outcomes.

Each question preregisters multiple fallback cases, including cases from the manager's next-ranked questions. Failed source cases enter a cross-round blacklist. Every successful intervention may be used only once across the population.

## Commands

```powershell
npm.cmd run autonomous-research -- cycle --rounds 6 --workers 4
npm.cmd run autonomous-research -- status
npm.cmd run autonomous-research -- inspect --manager manager-07
npm.cmd run autonomous-research -- doctor --verify-sources
```

The cycle is resumable and content-bound to the Stage-3 program and corpus archives. Completed cases are cached as compact signed summaries. Temporary replay branches are deleted after verification. Run state records the current phase, case, peak RSS, and failure details. Doctor also reconstructs every manager observation from the signed round plan and result, verifies contiguous rounds and exact case use, and recomputes the final summary instead of trusting stored counters.

All results have `exact-counterfactual-single-environment` authority and remain `shadow-only`. One exact replay can guide the manager's next research question, but cannot activate or rewrite battle policy.
