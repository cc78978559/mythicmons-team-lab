# Manager Program V2

Manager Program V2 is a typed, bounded shadow language for mechanisms learned by individual managers. It does not execute arbitrary JavaScript and it does not contain authored style preferences.

## Program model

Every manager starts with an empty program. A rule contains:

- a decision domain and action mechanism;
- one or two predicates over information available before the decision;
- a bounded score effect;
- support, uncertainty, evidence authority, and exact evidence ids.

The runtime returns the value, matched rules, program hash, and resource count for every evaluation. Programs are limited to 12 rules, two predicates per rule, and 32 evaluated rules per request.

## Autonomous revision

The learner enumerates thresholds observed in the manager's own evidence slice. It first searches one-condition mechanisms, then composes promising conditions into two-factor hypotheses. A universal information objective chooses the next hypothesis; no feature or action receives a hand-authored preference.

A proposal is retained only when it improves both the manager's discovery evidence and a separate validation split. Rejected hypothesis ids remain in revision history and cannot be proposed again. The final test split is never used to choose or retain a rule.

The current credit target is the change in Stage-2 position value before the manager's next paired decision. This is local observational credit, not proof that the selected action caused the change. Consequently every delivered program remains `shadow-only`.

## Local tools

```powershell
npm.cmd run manager-program-v2 -- build
npm.cmd run manager-program-v2 -- status
npm.cmd run manager-program-v2 -- inspect --manager manager-01
npm.cmd run manager-program-v2 -- doctor --verify-sources
```

`build` is content-signature cached and leaves its phase, peak RSS, and failure list after abnormal termination. `doctor` validates every program, evidence binding, Stage-1 policy, Stage-2 model, and optionally all source hashes. The unified `tooling doctor` reports Stage-3 availability and health.

Terastallization and Dynamax are not program features or actions. Any source battle that actually selects either mechanic is excluded. Mega Evolution remains outside this filter.
