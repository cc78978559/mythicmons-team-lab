# Development ecology baseline v1

This baseline freezes the current schema-15 development ecology as a reproducible local experiment. It does not commit or publish the working tree.

## Standard run

```powershell
npm run soak:development-league -- `
  --source output/test-v12-smoke `
  --out output/development-ecology-baseline-v1 `
  --cycles 12 `
  --seasons-per-cycle 1 `
  --capacity 6 `
  --retention compact `
  --academy-grant-pool 120 `
  --academy-signing-fee 10 `
  --academy-market-offer-percent 100 `
  --academy-emergency-sale-discount-percent 25 `
  --force
```

This command explicitly preserves the pre-calibration economic profile used by baseline v1. The profile uses the active academy market with enforced manager consent and contract negotiation. It runs one real development season per cycle, promotes one manager, eliminates one manager, and lets lifecycle retirement create additional vacancies.

Compact retention keeps cycles 1, 6, and 12 plus the aggregate baseline, summary, and report. Later cycles remain resumable from the final retained directory. The major-league source hash is checked after the run.

## Hard acceptance

- Major-league source remains byte-identical.
- Population always equals configured capacity.
- Active child identities remain unique.
- Academy treasury never becomes negative.
- Market, contracts, salary guarantees, and academy economy conserve funds within `1e-6`.

## Advisory calibration checks

- At least two founder lineages and two emergent styles remain at the end.
- Mean personality similarity remains at or below `0.97`.
- Average insolvent academies remain below one third of capacity.
- At least one market deal executes per three cycles.
- Final average academy treasury remains at or below 60 units.
- Final guaranteed salary debt is zero.

Advisory failures do not invalidate mechanics. They identify parameters that need tuning before the profile can become a production default.

Emergency-sale candidates and completed emergency sales are retained as coverage metrics, not ecology-quality warnings. A candidate may be rejected legitimately by buyer budget, manager consent, or contract negotiation. The actual emergency-sale execution path is verified by the deterministic development-league smoke test.

## Outputs

- `baseline.json`: immutable source identity, run profile, retention, and acceptance criteria.
- `summary.json`: all cycle metrics, violations, warnings, final ecology, and aggregates.
- `report.md`: compact human-readable verdict.
- `cycle-001`, `cycle-006`, `cycle-012`: retained audit checkpoints in the standard 12-cycle compact run.
