# Thirty-manager league scale validation

The production V12 major league defaults to 30 managers. Earlier ecology calibration used a six-manager development pool for cheap iteration; it did not establish production-scale performance.

## Major-league baseline

The formal one-season baseline used the unchanged V12 production defaults:

- 30 managers
- pool size 420
- 60 auction lots
- 24 regular-season rounds
- maximum 180 battle turns
- compact evidence retention

It completed in 86.8 seconds and produced 73.7 MB. The V12 audit found zero fatal errors and zero warnings across 742 lineups and 764 battle evidence files. Money was conserved, all 30 manager identities were unique, and no battle was missing, stalled, unended, or timed out.

## Development-league scale profile

The validated 30-manager development profile is:

```powershell
npm run soak:development-league -- `
  --source output/formal-league-30-v1 `
  --out output/development-ecology-30-reserve100-v1 `
  --cycles 8 `
  --seasons-per-cycle 1 `
  --capacity 30 `
  --parent-limit 30 `
  --promotion-slots 3 `
  --elimination-slots 3 `
  --regular-rounds 1 `
  --academy-grant-pool 525 `
  --academy-grant-load-percent 100 `
  --academy-payroll-reserve-percent 100 `
  --academy-market-max-transactions 10 `
  --retention compact `
  --force
```

The grant pool is the six-academy value of 105 scaled linearly to 30 academies. Load weighting redistributes that fixed pool toward organizations carrying multiple managers. A 100% payroll reserve makes verified salary debt and continuing contracts senior to discretionary facilities and scouting spend.

## Result

Across eight observation cycles the profile had no hard invariant violation. Compared with the same 30-manager profile without payroll reserves:

| Metric | No reserve | Payroll reserve 100% |
|---|---:|---:|
| Average guaranteed debt | 15.99 | 4.61 |
| Maximum guaranteed debt | 35.93 | 17.29 |
| Average insolvent academies | 5.50 | 1.88 |
| Market transactions | 25 | 27 |
| Final founder lineages | 22 | 24 |
| Final styles | 8 | 9 |

Debt reached zero during observation cycle 7. Observation ended during a new 8.59-unit salary episode; a bounded continuation reached zero after two additional cycles. This satisfies the existing recovery rule while preserving market activity and personality diversity.

Compact retention kept three checkpoints and used about 137 MB for the eight-cycle development run. The generated output remains local and ignored by Git.

The 100% load and payroll-reserve settings are the recommended 30-academy scale profile. They do not replace the separately calibrated six-academy defaults.
