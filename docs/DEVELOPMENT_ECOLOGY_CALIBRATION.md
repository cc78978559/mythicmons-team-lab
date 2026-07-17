# Development ecology calibration v1

The calibration runner compares the frozen default baseline with three bounded economic profiles. It never changes the production defaults automatically.

```powershell
npm run calibrate:development-league -- `
  --source output/test-v12-smoke `
  --baseline output/development-ecology-baseline-v1 `
  --out output/development-ecology-calibration-v1 `
  --cycles 12 `
  --capacity 6 `
  --force
```

## Ranking policy

Hard invariant failures dominate the score. True ecology advisories follow. Among valid profiles, the score penalizes insufficient market activity, final average treasury outside 10-60 units, and average insolvency. Emergency-sale eligibility is reported as coverage rather than treated as a failure because a legal candidate is not guaranteed to find an affordable and consenting transaction.

## Promoted default profile

`grant105-offer115` is the calibrated default profile:

- academy grant pool: 105
- signing fee: 8
- market contract offer: 115%
- emergency-sale discount: 35%

In the deterministic 12-cycle comparison it completed 10 market deals, ended with zero guaranteed debt, retained four founder lineages and five styles, and had the lowest average insolvency and average debt of the three calibrated profiles.

A subsequent 24-cycle confirmation passed with no hard violations or advisory warnings. It completed 21 market deals, ended with four founder lineages, two styles, 0.949 mean personality similarity, zero guaranteed debt, and 42.2 average academy treasury. On that evidence the four parameters were promoted to the `developmentLeague` and development-soak command defaults. Market policy itself remains `shadow`; callers must still explicitly select `active` to mutate academy balances and assignments.

## Cross-seed validation

Use the multi-seed runner to keep the initial manager population fixed while changing the deterministic world seed:

```powershell
npm run validate:development-ecology-seeds -- `
  --source output/test-v12-smoke `
  --out output/development-ecology-multiseed-v1 `
  --seed-count 4 `
  --cycles 12 `
  --recovery-cycles 8 `
  --capacity 6 `
  --force
```

Each run uses compact retention. If observation ends during a salary-debt episode, the runner follows that world line for a bounded eight-cycle recovery window; transient endpoint debt is accepted only after an actual zero-debt cycle is observed. The runner checks that the original source is byte-identical afterward and reports both individual outcomes and the worst-case envelope.

`--reuse-observations` may be used after an interrupted or analysis-only rerun to retain already completed observation windows while rebuilding recovery analysis.

The current four-seed run passed all hard and advisory checks across 48 observation cycles. Every world retained at least three founder lineages and two styles, final similarity stayed at or below 0.969, and each world completed at least seven market transactions. Three worlds ended observation during a debt episode; all reached a zero-debt cycle within the eight-cycle recovery window, with the slowest taking five cycles.

## Cross-population validation

After cross-seed validation, hold the deterministic world seed constant and change the initial manager population:

```powershell
npm run validate:development-ecology-populations -- `
  --sources output/test-v12-smoke,output/whitebox-memory-v12,output/whitebox-ai-import-league `
  --out output/development-ecology-populations-v1 `
  --cycles 12 `
  --recovery-cycles 8 `
  --capacity 6 `
  --force
```

The default set covers a standard six-manager V12 population, a six-manager population with different accumulated memory, and an imported eight-manager population. All use the same derived world seed so population history is the principal changed variable.

The current three-population run passed with no hard failures or warnings. Every population ended with four founder lineages, at least two styles, similarity at or below 0.965, and recoverable debt. Testing the eight-manager source also exposed and fixed inactive academies receiving grants: academy creation is now limited to the actual parent organizations selected by `--parent-limit`.

## Formal local release

After all gates pass, create a hash-verified local release containing the independently verifiable white-box manager core, development ecology source overlay, calibrated parameters, and compact acceptance evidence:

```powershell
npm run release:development-ai -- `
  --core output/development-ai-release-v1-core `
  --validation output/development-ecology-validation-v1 `
  --multiseed output/development-ecology-multiseed-v1 `
  --populations output/development-ecology-populations-v1 `
  --calibration output/development-ecology-calibration-v1 `
  --scale-30 output/development-ecology-30-reserve100-v1 `
  --scale-30-recovery output/development-ecology-30-reserve100-recovery-v1 `
  --out output/development-ai-release-v1 `
  --force
```

Use `--verify-only` afterward. Verification rejects any missing, changed, or unexpected payload and independently verifies the nested white-box core release.

Register and activate an accepted package through the local rollback registry:

```powershell
npm run registry:development-ai -- --action register --release output/development-ai-release-v1
npm run registry:development-ai -- --action activate --release-id <release-id>
npm run registry:development-ai -- --action verify
```

Activation writes a small `active.json` pointer. Future accepted releases can replace it without deleting earlier packages; `--action rollback` returns to the previous eligible release.
