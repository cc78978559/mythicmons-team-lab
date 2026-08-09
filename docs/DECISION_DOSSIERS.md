# Decision Dossiers

Decision dossiers are the stage-1 evidence surface for inspecting one AI choice at a time. They cover battle choices and league operations such as drafting, auctions, lineups, waivers, playoffs, and reviews.

## Evidence Model

- Raw `ai-decisions.json[.gz]` and `decision-ledger.json` files remain canonical.
- `decision-dossiers.sqlite` is a compact, rebuildable index. It stores summaries, source hashes, and exact locators rather than copying full candidate arrays.
- Large operational contexts are represented by scalar fields, collection counts, and small samples. Hydration remains the lossless path to the canonical record.
- Hydration verifies the raw source hash before returning the original record.
- Battle results are labelled `terminal-observational`. A win after a choice is context, not proof that the choice caused the win.
- Evidence-era compatibility is attached to every battle choice. Historical evidence can guide exploration but cannot activate a formal AI policy.

## Commands

```powershell
npm run decision-dossiers -- build --league output/official-era-03/league
npm run decision-dossiers -- status
npm run decision-dossiers -- doctor
npm run decision-dossiers -- doctor --verify-sources
npm run decision-dossiers -- manager --manager manager-01 --season 21 --limit 20
npm run decision-dossiers -- show --id dd-... --hydrate
```

Builds are incremental by content hash. `status` reads the compact summary. `doctor` checks SQLite integrity and policy bindings without traversing the league; `--verify-sources` deliberately performs the slower source-hash audit.

## Delivery Gate

Stage 1 is healthy when the store has no structural anomalies, every row has an actor and source locator, terminal outcomes are observational, and hydrated records still match their source hashes. Formal decision coverage remains blocked until current evidence-era battles supply eligible decisions.

Coverage is reported at two distinct resolutions. `fullTraceBattles` preserve every logged tactical choice and candidate frontier. `keySummaryBattles` preserve only the locally selected key choices recorded by the season ledger. `overlappingBattles` prevents these sources from being double-counted.
