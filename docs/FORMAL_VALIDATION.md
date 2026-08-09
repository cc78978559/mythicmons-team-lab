# Formal Validation

Stage 5 converts promising Stage-4 observations into prospective evidence without granting automatic policy authority.

## Protocol

The freeze is written before prospective source generation. It binds the Stage-3 programs, Stage-4 research state, position-value model, benchmark teams, registry hash, evidence policy, signed validation-history snapshot, candidate domains, source exclusions, environments, sample targets, and statistical gate.

The selector aggregates every Stage-4 observation for a mechanism before deciding. It accepts only candidates with at least two supporting managers, two supports, four research cases, four independent source fingerprints, no contradiction, and one intervention direction. Identity has two levels: a family key for related research and a semantic key that includes manager-specific thresholds and effect sizes. An exact rejected semantic variant is retired; a materially revised variant may return with explicit parent lineage. An inconclusive variant may be replicated at most once per generation only after acquiring at least two new discovery fingerprints.

The two environments are genuinely different sources: the fixed modern benchmark pool and the latest completed 30-manager formal league rosters with their own tactical profiles. Their complete team sets and profiles are hash-bound into the freeze. Before league sources run, the signed registry is compiled into its hash-namespaced Showdown format; historical custom species are never resolved through an unrelated default mod. Matchup pairs form evidence clusters, and no cluster can exceed its preregistered case budget. Every source has a complete formal evidence context. A battle may supply at most one planned intervention across the entire family. Stage-4 discovery fingerprints are excluded.

Every reserved case passes an incumbent-replay screen before the signed plan is written. Rejected source fingerprints and errors remain in the plan audit. Each primary still reserves one independent fallback for diagnosis, but any failed attempt or fallback selection now fails the formal generation. Source, prefix, and intervention verification must all be true before a result can enter the completed set or case cache. A competitive result can never trigger replacement.

## Gate

Each domain requires:

- 24 exact cases and 24 matchup clusters, with at least 12 from each environment;
- at least six interventions that change the winner;
- more supporting than contradicting winner changes in every environment;
- a cluster-level one-sided exact sign test that survives Holm correction across all frozen domains at familywise alpha 0.10;
- zero failed attempts, zero fallback selections, zero unresolved failures, and no source drift, prefix drift, duplicate battle, or discovery leakage.

Passing produces `limited-canary-eligible`. It does not edit a manager program or enable a policy. Rejection, inconclusive evidence, and technical blocking are distinct outcomes.

All signed current and archived generations are retained in the compact validation portfolio, but only generations with `formalValidationCompleted=true` and a healthy audit contribute to formal evidence totals. Retained and failed generation counters remain separate, so interrupted work cannot inflate evidence health. Stage 4 consumes a frozen copy of that portfolio in its next generation. The separate canary handoff binds the formal freeze and summary, declares budgets and rollback triggers, and reports `no-candidate`, `adapter-required`, or `execution-ready`. At most one decision domain is nominated for canary at a time. A candidate without a reviewed, locally hash-verified, semantics-preserving live adapter cannot be mislabeled execution-ready.

## Commands

```powershell
npm run formal-validation -- cycle
npm run formal-validation -- cycle --resume
npm run formal-validation -- status
npm run formal-validation -- doctor
npm run formal-validation -- doctor --verify-sources
npm run formal-validation -- inspect --domain battle-switch
npm run formal-canary -- plan
npm run formal-canary -- status
npm run formal-canary -- doctor
npm run smoke:formal-canary-e2e
```

The cycle is resumable. Source manifests, the frontier, signed plan, case cache, compressed results, run state, failure list, and compact token budget are retained locally. Cached cases are reused only after their source, action, environment, and expected-direction bindings match the signed plan. Doctor reconstructs plan coverage from the frozen frontier, validates one result per planned case, and recomputes the summary. A max-turn adjudication may end in a signed exact tie; it remains a valid 0.5 outcome rather than a technical failure. After execution, decision traces and battle logs are atomically gzip-compressed. Doctor hashes their decompressed semantic bytes, so storage compaction does not weaken source verification or replay support.
