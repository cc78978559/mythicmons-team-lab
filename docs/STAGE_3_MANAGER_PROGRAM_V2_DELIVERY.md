# Stage 3 Delivery: Manager Program V2

## Evaluation

Strategy Program V1 is a bounded arithmetic tree over five scalar entrypoints. Its mutation operators can perturb a score and sometimes cross an observed decision margin, but the program cannot represent a named hypothesis, evidence authority, validation failure, or the reason one component changed. Rejected mutations are not part of a manager's working memory. This makes V1 useful as a replay-compatible baseline, not as the final autonomous manager model.

Stage 1 supplies manager identities and auditable decision provenance. Stage 2 supplies a symmetric pre-action position value. The official Stage-1 archive is historical-only and the Stage-2 corpus is prospective shadow evidence, so neither grants formal control authority.

## Design

V2 begins with an empty program for all 30 managers. It discovers conditional action mechanisms from observed thresholds, composes up to two conditions, chooses a hypothesis under the same information objective, and records every accepted or rejected revision. Managers receive different deterministic experience slices; their preferences emerge from evidence rather than assigned speed, offense, or species weights.

Rules are a typed data structure rather than executable source code. Fixed resource budgets, finite-number checks, evidence hashes, revision ordering, and shadow-only authority are validated on load and evaluation. A rejected hypothesis cannot be proposed again.

The evidence split is by team-matchup cluster: 5,882 decisions for discovery, 2,346 for validation, and 2,288 untouched decisions for final testing. Rule retention requires positive improvement on discovery and validation. Testing cannot alter a program.

## Tooling Optimization

The first complete build exposed two engineering defects. Model verification initially used ordinary JSON hashing instead of the evidence layer's canonical hash; the failed build stopped at the input phase and left a diagnostic record. Candidate discovery also scanned the full sample table for every action-specific hypothesis, and rejected hypotheses could repeat.

The delivered builder reuses canonical evidence signatures, partitions candidates by action before scanning, caches unchanged builds, and remembers rejected hypotheses. A clean 30-manager, eight-revision build fell from 227.1 seconds to 57.3 seconds, about 4.0 times faster. Peak RSS was about 405 MB. An unchanged signed rebuild took 1.8 seconds. Full verification of all 180 source pairs took about 4 seconds.

## Execution

The corpus contains 10,516 paired local-value decisions from 180 battles and 45 matchup clusters. No battle selected Terastallization or Dynamax, so the exclusion counter is zero. Action coverage includes switching, physical and special attacks, priority, recovery, status, hazards, removal, pivoting, and setup.

Across 240 autonomous proposals, managers accepted 159 rules and rejected 81. All 30 managers retained at least one rule. The registry contains 30 distinct program hashes and 30 distinct behavioral hashes; 158 accepted rules combine two conditions. No rejected hypothesis was proposed twice.

On the untouched test split, mean squared error improved from `0.006535` for the empty novice program to `0.005794`, an `11.33%` reduction. All 30 manager programs improved over their novice baseline and none regressed. Discovery and validation improvements averaged `12.22%` and `8.15%` respectively.

## Review

Stage 3 is delivered as an auditable autonomous hypothesis-and-program layer. It demonstrates that managers can start identically, choose what to test, remember falsification, build different conditional mechanisms, and improve an unseen local-value target without authored play-style weights.

It is not yet a formal battle controller. Local value between adjacent paired decisions includes the opponent's intervening action and therefore cannot establish action causality. The next stage must evaluate V2 proposals with exact action counterfactuals and current-era league evidence before any decision domain can receive formal authority.
