# Manager development league

The development league turns punctuated personality mutations into independent offspring managers instead of overwriting their parents.

## Implemented multi-cohort path

1. Read a completed V12 major-league dynasty.
2. Keep a fixed carrying capacity of 6–30 development managers.
3. Continue every retained manager from the previous cycle, preserving its personality, safe opponent memory, lineage history, cumulative career, and remaining affiliate option.
4. Remove promoted and eliminated managers, then fill exactly the vacant places with newborn offspring through inheritance, bounded mutation, and an optional second parent.
5. Allocate a bounded share of those births to the highest-ranked retained development managers. This creates generation-two grandchildren without allowing one successful personality to flood the population; remaining births still use major-league parents.
6. Give every newborn an independent lineage, name, personality profile, three-year affiliate option, and temporary development-league slot. A grandchild inherits its development parent's affiliate organization, not its identity.
7. Count every active founder lineage before each birth. A newborn cannot push its founder above the configured population share. Existing retained managers are never deleted to satisfy a new limit; an overrepresented founder is simply frozen out of further births.
8. Reject optional second parents that share an ancestor within the configured kinship depth. The number of excluded mate candidates is retained as audit evidence.
9. Compare unrelated parent personalities with a deterministic white-box distance. Continuous personality, economics, learning, tactics, configuration, system, and organization parameters contribute 70%; preferred-role overlap contributes 10%; fixed-probe strategy-program behavior contributes 20%. Overly similar second parents are excluded.
10. Separate inheritance from nurture. After inheritance and mutation finish, the affiliate rights holder applies a bounded academy influence derived from its existing quality, patience, experimentation, tactical, configuration, system, and organization parameters. Grandchildren remain in the inherited affiliate organization.
11. Preserve a full parameter-delta trace for academy nurture. Strategy programs remain inherited and are never silently rewritten by the academy step.
12. Persist each academy independently across cohorts. Before the next births, real alumni promotion, retention, elimination, and rank update facility quality, patience, and experimentation by a bounded rate.
13. Allow a successful alumnus to become a small cultural reference for its academy. The culture template moves only a bounded distance, retains its own stable academy identity, and stores the selected alumnus plus before/after organization values as evidence. Major-league source profiles remain read-only.
14. Give each academy a persistent treasury and normalized allocations for facilities, scouting, patience, and experimentation. A fixed league grant pool is competitively distributed using alumni performance; positive performance can also produce bounded organization revenue.
15. Enforce a per-cycle spending ceiling and exact budget conservation. Resource utilization scales organization evolution, while evolved scouting ability controls the probability of discovering an eligible second parent. Unfunded academies retain evidence but cannot improve or adopt a new cultural model.
16. Run a bounded academy talent market before the new cohort. Expired options create free agents, active options can be permanently transferred or loaned for one cycle, and personality-to-culture fit is recorded for every proposal. Shadow is the default and produces no mutation.
17. Give every manager an explicit white-box consent calculation. Loyalty, ambition, opportunity need, and culture tolerance produce culture, quality, opportunity, security, and loyalty utility components for each proposed move.
18. Enforce manager consent by default. A refusal records its complete utility evidence but changes no money, rights, option years, training academy, or personality and does not consume a completed-transaction slot. An explicit ignore mode exists only for controlled experiments and still records that the manager would have refused.
19. Negotiate a white-box salary after manager consent. Ambition, current prestige, existing salary, destination culture, destination quality, the salary ceiling, and post-fee affordability determine demand and offer. A failed negotiation has the same zero-side-effect guarantee as a consent refusal.
20. Persist annual salary and a separate contract term. Market execution prepays only the current development-cycle seasons; the remaining contract term survives into later cohorts. An experimental contract-ignore mode can force a low offer but keeps `contract.accepted: false` in evidence.
21. Settle every non-prepaid manager's payroll once per cycle. Unexpired contracts retain their rate. Expiring contracts compare deterministic demand and offer; unresolved gaps enter deterministic salary arbitration, weighted 60% toward manager demand by default. Unaffordable awards release the manager. Existing-contract insolvency records partial payment and arrears, clears contract and option years, and never creates negative treasury.
22. In active market mode, enforce organization affordability and a transaction ceiling. Transfers and loans conserve academy-system fees; free-agent signing fees and current-cycle salaries are explicit outflow. A traded manager receives a small, separately audited nurture step from its destination, while a loan preserves the original rights holder.
23. Assess every retained manager's lifecycle before the next cycle. Juveniles cannot reproduce; mature managers can reproduce inside a bounded fertility window; older managers stop producing offspring and enter a deterministic, seed-replayable retirement risk; a hard career limit guarantees eventual retirement.
24. Archive lifecycle retirees and fill their vacancies with newborn managers. Retirement never mutates the previous cycle and does not count as poor competitive elimination.
25. Run a real compact V12 league with drafting, contracts, team operations, learning, and Showdown battles. Further evolution remains shadow-only inside this league.
26. Rank cumulative realized careers after competition. Titles, points, average rank, consistency, and a bounded rare-style niche bonus determine reproductive fitness.
27. Export promoted, retained, eliminated, and lifecycle-retired groups. Eliminated and retired managers receive compact archive records; promoted managers receive a complete compressed personality and cumulative-career package for later top-league signing.

The major-league source is read-only. Promotion is a candidate result and never silently changes the source league.

## Long-run ecology baseline

Use the bounded soak runner to chain real development cycles, verify hard invariants, and measure founder diversity, personality similarity, style diversity, debt, insolvency, market activity, emergency sales, and treasury accumulation:

```powershell
npm run soak:development-league -- `
  --source output/test-v12-smoke `
  --out output/development-ecology-baseline-v1 `
  --cycles 12 `
  --seasons-per-cycle 1 `
  --capacity 6 `
  --retention compact `
  --force
```

Compact retention keeps the first, middle, and final cycle plus aggregate JSON and Markdown reports. Hard violations return a failing exit code; calibration warnings retain a successful exit code and mark the run `passed-with-warnings`. The complete frozen profile and acceptance criteria are documented in `docs/DEVELOPMENT_ECOLOGY_BASELINE.md`.

For bounded economic parameter comparison and the current experimental recommendation, see `docs/DEVELOPMENT_ECOLOGY_CALIBRATION.md` and run `npm run calibrate:development-league`.

The production V12 major league defaults to 30 managers. The six-manager commands above are deliberately cheap ecology-validation profiles, not the formal league capacity. For scaled validation, set `--capacity 30 --parent-limit 30`; scale the six-academy grant pool of 105 linearly to 525, and explicitly choose promotion, elimination, and market-transaction limits appropriate for the larger pyramid.

The measured production-scale profile and its debt/recovery comparison are documented in `docs/DEVELOPMENT_ECOLOGY_30.md`.

## Run

```powershell
npm run development-league -- `
  --source output/draft-league-v12 `
  --out output/development-league `
  --seasons 3 `
  --parent-limit 6 `
  --children-per-parent 1 `
  --promotion-slots 1 `
  --elimination-slots 1
```

Continue the retained population into the next cycle and refill vacancies to the same capacity:

```powershell
npm run development-league -- `
  --source output/draft-league-v12 `
  --previous output/development-league `
  --out output/development-league-cycle-2 `
  --capacity 6 `
  --seasons 3 `
  --development-parent-percent 50 `
  --max-founder-share-percent 50 `
  --kinship-depth 2 `
  --max-parent-similarity-percent 90 `
  --academy-influence-percent 15 `
  --academy-evolution-percent 10 `
  --academy-initial-budget 30 `
  --academy-grant-pool 120 `
  --academy-max-cycle-spend 30 `
  --academy-performance-revenue 10 `
  --academy-market-policy shadow `
  --academy-market-consent-policy enforce `
  --academy-market-consent-threshold-percent 50 `
  --academy-market-contract-policy enforce `
  --academy-rookie-salary 2 `
  --academy-market-base-salary 3 `
  --academy-market-max-salary 10 `
  --academy-contract-years 3 `
  --academy-arbitration-demand-percent 60 `
  --academy-market-max-transactions 2 `
  --academy-signing-fee 10 `
  --academy-transfer-fee 15 `
  --academy-loan-fee 5 `
  --academy-transfer-min-fit-percent 15 `
  --academy-loan-min-fit-percent 5 `
  --maturity-seasons 2 `
  --fertility-max-seasons 8 `
  --retirement-min-seasons 8 `
  --retirement-hard-seasons 12 `
  --retirement-base-percent 25 `
  --retirement-growth-percent 15 `
  --promotion-slots 1 `
  --elimination-slots 1
```

Each cycle must use a new output directory. `--previous` is read-only. If `--capacity` is omitted, the previous cycle's capacity is inherited. `--development-parent-percent` is an integer from 0–100 and defaults to 50; the actual number is also capped by the number of vacancies and eligible retained parents, and each retained parent receives at most one primary-parent birth per cycle. `--max-founder-share-percent` defaults to 50 and is enforced only against new births. `--kinship-depth` defaults to two generations; zero explicitly disables mate-relatedness checks. `--max-parent-similarity-percent` defaults to 90; 100 disables practical similarity filtering, while lower values demand more behavioral difference.

`--academy-influence-percent` defaults to 15 and is bounded to 0–50. Effective influence is scaled to 75%–125% of that value by the affiliate's quality, so the default effective range is 11.25%–18.75%. Influence moves a newborn toward the organization's white-box tradition; it does not replace the child's personality, alter lineage, or edit its strategy program. A value of zero disables nurture while retaining the evidence envelope.

`--academy-evolution-percent` defaults to 10 and is bounded to 0–50. Alumni outcomes produce a signed performance score from competitive status and rank. Facility quality changes by at most 20% of the configured rate per cohort; patience and experimentation have still smaller limits. A positive alumnus may move the compact culture template by at most 25% of the configured rate, further scaled by performance. Setting the rate to zero preserves outcome evidence while freezing organization values.

Academies begin with 30 budget units. The calibrated default fixed grant pool is 105 units per cohort and is split with weights from `0.5` to `1.5` according to prior alumni performance, so one academy's larger share necessarily reduces another's. Positive alumni performance can add up to 10 organization-revenue units. Each academy may spend at most 30 units per cohort. Allocations always sum to one, spending subaccounts sum to total spend, and every output enforces `opening budget + grant + revenue - spend = closing budget`. With no available spend, facility, scouting, culture, patience, and experimentation remain unchanged.

`--academy-grant-load-percent` adds a bounded grant weight for every affiliated manager beyond the first. It defaults to zero, preserving the calibrated six-academy profile. Larger league pyramids can use it as a solidarity payment for organizations carrying multiple development contracts without increasing the total grant pool.

`--academy-grant-debt-percent` adds a reactive recovery weight based on the prior cycle's verified salary-guarantee debt, normalized by the market base salary. It also defaults to zero. The weight redistributes the existing fixed pool and does not create money; debt settlement and conservation remain separately audited.

`--academy-payroll-reserve-percent` protects a percentage of prior guaranteed debt plus the current-cycle salary of continuing contracted managers before facilities and scouting spend is calculated. It defaults to zero for backward compatibility. At 100%, existing contractual payroll is senior to discretionary academy development spending.

Only organizations selected into the major-parent pool receive development academies. A larger source league therefore cannot create inactive academies that collect grants without parenting, employing, or developing a manager.

The talent market defaults to `shadow`; proposals, prices, fit changes, consent, and affordability are recorded, but balances and assignments remain identical. Explicit `--academy-market-policy active` enables at most two completed transactions per cohort by default. Manager consent defaults to `enforce` with a 50% acceptance threshold. `--academy-market-consent-policy ignore` is an experimental override: the deal can execute, but the ledger retains `consent.accepted: false`. Expired-option free agents sign for three new option years and receive the calibrated 8-unit signing fee. Permanent transfers cost 15 and require at least a 15-point fit improvement; one-cycle loans cost 5 and require at least a 5-point improvement. Emergency transfers receive a calibrated 35% fee discount. Transfer and loan fees move between academies, while signing fees leave the academy system. Negative fit thresholds are accepted only for explicit experiments.

Newborn managers begin at annual salary 2 and a three-year contract. A market transaction uses base salary 3, maximum salary 10, and a calibrated 115% offer multiplier. The manager's demand cannot fall below its current salary; the academy offer cannot exceed its salary ceiling or remaining treasury after the transaction fee. Executed deals prepay `annual salary × --seasons`, and that cost leaves the academy system. Contract negotiation defaults to `enforce`; `--academy-market-contract-policy ignore` is an experimental override that retains `contract.accepted: false`.

`--academy-contract-years` controls new and renewed contract length and defaults to three. Every non-market-prepaid manager is charged once for the current cycle. When the remaining term is shorter than the cycle, performance, ambition, culture fit, and academy quality produce renewal demand and offer. If enforced negotiation does not agree, `--academy-arbitration-demand-percent` (default 60) blends manager demand with the offer. An affordable award becomes the new salary; an unaffordable award releases the manager. Existing-contract insolvency pays only available treasury, records exact arrears, and clears contract and affiliate option years so the manager can enter free agency next cycle. Market-prepaid managers are explicitly marked `prepaid` and never charged twice.

Earned salary arrears are guaranteed across cycles. The debt belongs to the original academy and survives manager transfer, promotion, elimination, or retirement. At the start of the next cycle, guarantees are paid oldest-first before the talent market and current payroll. Partial repayment leaves a smaller persistent debt; exact debt and treasury conservation are recorded independently. Each academy also receives a `healthy`, `strained`, `distressed`, or `insolvent` rating derived from guaranteed debt, current payroll coverage, and closing reserve coverage. Any unpaid guaranteed debt produces `insolvent`; low obligation or reserve coverage produces the intermediate warnings.

The prior rating has deterministic consequences in the following cycle. `healthy` keeps full spending and acquisition access. `strained` starts a recovery plan and reduces academy development spending to 75%. `distressed` reduces it to 40% and blocks incoming free agents, transfers, and loans. `insolvent` enters trusteeship, sets non-payroll development spending to zero, and applies the same acquisition embargo. A debt present at cycle opening forces the insolvent control even if the academy repays it during that cycle; this prevents a grant from instantly bypassing oversight. The persisted exit criteria are zero guaranteed debt, full current payroll, and reserve coverage of at least one. Selling or loaning out an existing manager remains allowed because it can support recovery.

Recovery governance also changes academy leadership allocations without editing any manager personality. Strained leadership shifts 25% toward a reserve-oriented target; distressed leadership shifts 60%; trusteeship applies a full target of 10% facilities, 10% scouting, 70% patience, and 10% experimentation. Each plan records its entry cycle, consecutive recovery cycles, cumulative trusteeship cycles, leadership action, emergency-sale eligibility, and an itemized exit assessment. A plan that meets every exit criterion becomes `exit-pending`: current-cycle controls remain in force, then the next cycle may return to normal.

Distressed and insolvent academies may initiate an emergency permanent sale. The default price is a 25% discount from the normal transfer fee and the usual culture-fit transfer threshold is waived, but manager consent, destination affordability, destination acquisition eligibility, and contract negotiation remain mandatory. The transaction is explicitly marked `financialIntervention: emergency-sale`. This provides a recovery channel without treating managers as assets that can be moved against their audited preferences.

Lifecycle defaults are maturity at two completed development seasons, fertility through season eight, retirement eligibility at season eight, and mandatory retirement at season twelve. Retirement probability begins at 25% and rises by 15 percentage points per additional career season, capped below certainty until the hard limit. The roll is derived from source seed, cycle, and stable child identity, so exact replays agree. Newborns receive three option years; retained managers consume their remaining years, becoming independent when the value reaches zero without losing their identity or eligibility to compete.

Important outputs:

- `entrants.json`: cycle, capacity, lifecycle policy and retirements, persistent academy revisions, treasuries, allocations and culture templates, shadow or active talent-market ledger including emergency sales, recurring payroll and renewal/arbitration ledger, persistent salary-guarantee debt, repayment evidence, academy financial-health ratings, recovery duration, leadership intervention, acquisition embargo and trusteeship evidence, persistent annual salary and contract term, temporary training academy, academy quality and parameter deltas, founder diversity snapshot, kinship and personality-similarity exclusions, scouting chance, origin, generation, parent source, parentage, affiliate rights, mutations, prior career, and child lineages.
- `league/`: the real V12 development dynasty.
- `development-summary.json`: promotion, retention, elimination, and compact extinction archive.
- `promotion-package.json` plus `promotion-package.json.gz`: verified payload metadata and the complete promotable AI personality.
- `development-report.md`: compact human-readable standings and status.

After the summary and promotion package have been verified, `npm run compact:development-league -- --source <development-output> --prune-league` writes a hash-verified compressed final-manager state and removes the high-volume internal dynasty. The official season-cycle command performs this retention stage automatically after a committed promotion; the standalone command remains available for older or manually generated cohorts. Later cycles automatically prefer the compact state, so personality, learning, lineage, and career continuity remain available without retaining battle logs or the full decision ledger. Pruning is restricted to the direct `league/` child of the explicitly named development output, which must also contain the expected entrants and summary artifacts.

## In-place top-league promotion (recommended)

At a clean audited season boundary, the production path automatically relegates the bottom `N` managers and assigns the top `N` verified development candidates in one atomic transaction. It preserves the dynasty directory, season numbering, assets, contracts, cash, dead money, market history, money supply, all completed-season evidence, and every non-relegated manager. The incoming manager keeps its development-league personality, learned memory, strategy program, and lineage, but starts a new major-league personal career with zero titles, points, and top-league seasons. Its punctuated-evolution pressure starts at zero rather than inheriting the outgoing manager's pressure.

```powershell
npm run promote-development-in-place -- `
  --major-source output/draft-league-v12 `
  --promotion output/development-league/promotion-package.json `
  --auto-bottom 3 `
  --transaction-id after-season-09
```

The command requires a matching clean `audit-summary.json`, recomputes its input signature, verifies the compressed promotion-package hash, and accepts only a schema-v2 package bound to the exact source root, state hash, seed, season, runtime fingerprint, registry, and audit signature. A package already consumed by the dynasty, a duplicate child, an active lineage, or a previously admitted lineage is rejected. The command rejects a live `.run.lock`, stores a compressed exact pre-transaction state and audit under `promotion-transactions/<id>/`, then atomically replaces `dynasty-state.json`. It also stores and hashes `dynasty-state.after.json.gz`: this is the exact post-promotion, pre-next-season checkpoint needed by future isolated counterfactuals, and prepared-transaction recovery verifies it before recording a recovered commit. Explicit retirement or exceptional vacancies remain available with `--replacements manager-05,manager-06 --candidate-indices 1,2 --reason retirement`.

Before another season has changed the state, the exact transaction can be rolled back:

```powershell
npm run promote-development-in-place -- `
  --rollback output/draft-league-v12/promotion-transactions/after-season-09/transaction.json
```

Rollback is refused unless the current state hash still equals the committed post-promotion hash. After promotion, resume the same dynasty normally with the next internal season number. If the runtime source changed since the checkpoint, authorize that source transition once with `V12_ALLOW_CODE_UPGRADE=true`.

A prepared transaction is recovered before any later promotion: if the current state still has the before hash it is marked aborted; if it has the planned after hash it is marked committed and the command stops for inspection; any third state is treated as ambiguous and blocked.

## Audited official-season pipeline

The resumable production command combines the clean pre-season audit, one development cohort, source-bound promotion package, atomic bottom-N promotion, verified development-output compaction, next major season, final audit, and optional global-history update. Every stage is persisted under `season-cycles/<cycle-id>.json`; a completed cycle is idempotent, and an unfinished cycle resumes from verified artifacts rather than repeating completed battles. A dedicated workflow lock prevents two season-cycle processes from mutating the same major-league boundary concurrently.

Normal operation should go through `npm run league -- <command>`. `status` and `doctor` inspect a compact state header rather than parsing or printing the full dynasty. `pause` writes a durable request; the runner completes its current atomic stage, records `paused`, releases its locks, and stops before the next stage. `resume` removes that request and reconstructs every bound cycle argument from the existing manifest. `next` infers the next development output and prior compact cohort at a completed boundary. `report` writes `league-control-report.md`. The runner also maintains the small machine-readable `league-status.json` whenever a stage changes.

An operating-system termination cannot execute the cooperative handler. In that case `status` reports `interrupted` when a non-complete manifest has no live owner, while `doctor` separately identifies stale locks or a partial uncommitted season directory. Diagnosis never modifies evidence. `resume` removes only known lock files whose recorded PID is no longer alive; a partial season directory or any other structural blocker still requires explicit inspection.

The cycle also binds its storage policy in the manifest. `--min-free-gb` defaults to `10` and is checked before mutation and again before the next major season. `--max-development-output-mb` defaults to `2048` and rejects an oversized uncompressed development result before promotion. Both observed free space and development output size are retained in stage evidence; a resumed cycle must use the same limits.

Add `--preflight-only` to validate the current clean audit, runtime signature or explicit upgrade authorization, history-ledger continuity, previous compact development source, target-output status, and storage policy without creating a cycle manifest or changing the dynasty. A failed preflight exits with status `2` and prints the individual readiness fields.

The formal source must already contain `dynasty-state.json`. A missing source returns exit status `2` with a compact `ready: false` result and `formal-state-missing` reason code before acquiring a workflow lock or creating the league root. Successful and failed preflights do not create `season-cycles`; that directory is created only when a real cycle stage is persisted. Non-preflight execution with a missing source remains a hard error.

```powershell
npm run official-season-cycle -- `
  --major-source output/official-era-02/league `
  --development-out output/official-development-season-19 `
  --previous-development output/official-development-season-18-active-era `
  --promotion-slots 3 `
  --cycle-id after-global-s19 `
  --global-season-offset 9 `
  --history-ledger output/official-era-02/official-history-ledger.json `
  --allow-code-upgrade
```

`--allow-code-upgrade` is deliberately explicit and should appear only on the first resumed season after reviewed runtime changes. Production-scale development automatically uses the validated 30-academy grant/load/payroll-reserve profile; smaller smoke populations retain the six-academy profile.

Build or rebuild one canonical global-season ledger from earlier era manifests and the current dynasty:

```powershell
npm run official-history -- `
  --major-source output/official-era-02/league `
  --global-season-offset 9 `
  --era-manifests output/official-dynasty/official-nine-season-manifest.json,output/official-era-02/official-active-era-manifest.json `
  --out output/official-era-02/official-history-ledger.json
```

The ledger rejects conflicting or missing global seasons and retains hashes for its source manifests, current state, audit, season seals, and promotion transactions.

## New-journey promotion (legacy/experimental)

A promoted manager can only enter through an explicitly authorized retirement or relegation vacancy. This starts a new competitive journey: learned personalities and lineages are preserved, while contracts, assets, cash, titles, points, and season records reset.

```powershell
npm run promote-development-manager -- `
  --major-source output/draft-league-v12 `
  --promotion output/development-league/promotion-package.json `
  --replace manager-06 `
  --reason retirement `
  --out output/promoted-major-league `
  --seasons 3
```

The source major league remains read-only. The command verifies the promotion-package hash, archives the outgoing manager in `promotion-transaction.json`, installs the incoming personality into exactly one authorized slot, verifies every other current lineage, and runs a new real V12 journey under shadow evolution.

## Current boundary

The current version supports one development tier, any number of explicitly chained cohorts, bounded multi-generation ancestry, founder-share control, depth-bounded kinship exclusion, parameter/strategy-based personality similarity, organization-specific academy nurture, evolution, budgets, manager consent, transaction salary negotiation, recurring payroll, contract expiry, renewal, deterministic arbitration, cross-cycle arrears guarantees, debt repayment, release, academy financial-health ratings, recovery-duration tracking, leadership allocation intervention, emergency sales, spending controls, acquisition embargoes and trusteeship, maturity, fertility windows, deterministic retirement, and auditable in-place top-league promotion. It does not yet create separate regional affiliate rosters, trade academy staff, negotiate multi-party deals, guarantee unearned future salary after release, replace the underlying academy personality under trusteeship, or support expansion slots.
