# MythicMons Team Lab

Phase 1 is a thin experiment harness around Pokémon Showdown. It does not reimplement battle mechanics.

## Commands

Run one fixed Team A vs Team B battle:

```bash
npm run simulate -- --teamA examples/teamA.txt --teamB examples/teamB.txt --seed 123
```

Run a small batch:

```bash
npm run simulate -- --teamA examples/teamA.txt --teamB examples/teamB.txt --seed 123 --games 10 --ai basic --out output/batch-001
```

Evaluate one candidate team against the benchmark pool:

```bash
npm run evaluate -- --team examples/teamA.txt --benchmarks benchmarks/gen9ou/index.json --seed 123 --games 3 --ai basic --out output/eval-teamA
```

Run a one-variable variant experiment:

```bash
npm run variants -- --team examples/teamA.txt --benchmarks benchmarks/gen9ou/index.json --seed 123 --games 3 --ai basic --kinds item,ability,move,evs --limit 24 --out output/variants-teamA
```

Build modern-team hybrids and run a common-seed comparison matrix:

```bash
npm run modern-hybrids -- --games 20 --replacement-mode all --ai search --open-team-sheets --out output/modern-hybrids
```

`--replacement-mode all` is the default and tests every one of the six replacement slots. This creates 432 hybrids for 12 source Pokemon and six host teams. Use `--replacement-mode role` only for a faster screening run. Host references and all variants of that host use the same opponent/game-index seeds; reports include paired delta intervals, technical-draw bounds, source-Pokemon KO contribution, failure reasons, replacement-plan hashes, and sandbox provenance. These are sandbox-modern results, not strict OU legality claims.

Compile and install an illegal/superspec sandbox team into the local Showdown package:

```bash
npm run sandbox -- --input examples/sandbox-overlord.json --out output/sandbox-overlord --install
npm run simulate -- --teamA output/sandbox-overlord/team.export.txt --teamB examples/teamB.txt --format gen9mythicmonssandbox --no-validate --ai basic --out output/sandbox-smoke
```

Smoke-test the simulation and evaluation pipeline:

```bash
npm test
```

Convert between Showdown team formats:

```bash
npm run team -- --input examples/teamA.txt --to json --output output/teamA.json
npm run team -- --input output/teamA.json --to packed --output output/teamA.packed.txt
```

Save a team into the local CLI database:

```bash
npm run team -- save --input examples/teamA.txt --name "Baseline Team A" --format gen9ou --tags baseline,fixture
npm run team -- list
npm run team -- show --id baseline-team-a-<hash>
npm run team -- export --id baseline-team-a-<hash> --to export --output output/baseline-team-a.txt
npm run team -- sandbox --id sandbox-team-id --output output/sandbox-team.json
```

The default local team database path is `data/teams.json`. Sandbox compilation saves the compiled team, original sandbox source, and compiler manifest by default; use `--no-save` only for scratch work. Use `--db path/to/teams.json` to keep a separate local database.

By default teams are validated against `gen9ou`. Use `--format gen9anythinggoes` for looser experiments, or `--no-validate` when you only want Showdown simulation to attempt to run the team.

## Benchmark Evaluation

Phase 2 adds a small `gen9ou` benchmark pool:

- balance
- stall/fat balance
- offense
- weather
- trick room
- hazard stack

Evaluation output is pool-relative, not an absolute claim that a team is "strong" or "weak". A score of `50` means the candidate split games against the current benchmark pool under the current AI, seeds, and Showdown version.

## AI Strategies

Use the same `--ai` value for every team you compare.

- `basic`: default evaluation strategy. It estimates state-dependent move value from Showdown data, current typing, weather, STAB, rough damage/KO risk, speed order, accuracy, and common standard source abilities/items inside MythicMons composites; it switches out of zero-value or likely losing positions.
- `tactical`: stateful evaluation strategy. It additionally prioritizes team plans such as Baton Pass, Trick Room, weather, screens, hazard control, recovery, and low-HP sacrifice moves. Its Baton Pass planner checks recipient compatibility, incoming KO risk, setup value, Substitute, and Speed Boost/Protect timing before passing. It preserves passed boosts, tracks Terastallized types, and uses role-aware leads and switch recipients.
- `search`: V13 audited open-sheet limited-horizon strategy. It assigns heuristic policy shares to legal opponent move, switch, and Tera responses, evaluates expected value plus downside and worst-case risk, then adds discounted follow-up value from projected HP and the next favorable action. League managers can supply distinct risk weights and auditable biases for attacks, setup, pivots, recovery, status, switching, and Tera. It tracks reserve HP/status/items/PP, uses open-sheet stats for speed and damage, models common status consequences, and keeps every branch score finite. Search `simulate` runs write `ai-decisions.json` with candidate scores, personality adjustments, and response policy shares by default; use `--no-ai-trace` to disable it. Batch `evaluate` and `modern-hybrids` keep traces off unless `--ai-trace` is supplied. Open team sheets are enabled by default for this strategy; use `--no-open-team-sheets` for information-limited experiments.
- `damage`: chooses the highest estimated damage or utility move and rarely switches except when forced.
- `first`: deterministic first legal move/switch. Keep this for smoke tests and regressions, not strength evaluation.

## Variant Experiments

The variant generator changes one variable at a time and evaluates the result against the same benchmark pool:

- item swaps
- legal alternative abilities
- one move replacement from a curated candidate list
- EV spread changes

The output answers: "relative to the baseline, did this one edit raise or lower win rate/score in this test run?"

Use `--kinds item,ability,move,evs` to choose mutation types and `--limit` to cap runtime. Invalid variants are skipped by default and listed in the report.

When `--team` points to a sandbox source JSON object, variants are generated before compilation. One source item, ability, move, or EV spread is changed while the remaining composite effects stay intact. Required synthetic definitions are merged and installed before the paired evaluation run.

## Sandbox Compiler

Phase 5 adds a compiler layer for illegal or over-spec teams. It does not replace Showdown's battle engine.

The compiler maps sandbox JSON to Showdown-readable content:

- multiple abilities become one synthetic ability that grants additional innate `ability:*` effects
- multiple items become one synthetic item that delegates common item hooks to each original item
- custom base stats/types become a synthetic forme/species in a generated mod
- custom moves are written to the generated mod's move data
- illegal move legality is handled by the sandbox custom format, so run with `--format gen9mythicmonssandbox`

`npm run sandbox -- --install` merges generated species, abilities, items, and moves into the local `node_modules/pokemon-showdown/dist` runtime. Existing MythicMons definitions remain available, and the complete previous mod directory plus `custom-formats.js` are timestamp-backed-up before installation. A different implementation using an existing custom ability/item/move ID is rejected; pass `--replace` only when that overwrite is intentional. Re-run saved sandbox sources after reinstalling dependencies.

A Mega Stone that selects the default Mega forme is treated as a compile-time forme marker and is not retained as an active item effect. Per-Pokemon exceptions such as Prankster affecting Dark types should use a functional custom ability instead of a global type-chart patch.

The report includes:

- matchup win rates
- average turns
- archetype breakdown
- kill contribution inferred from battle logs
- common failure reason labels inferred from hazard/status/pace events
- best and worst matchups

Normal Showdown ties score 0.5. Max-turn, idle, and wall-clock technical draws are reported separately and excluded from pool-relative scoring. If no matchup has a scored game, pool-relative score, consistency, and key matchups are reported as `n/a`/`null`. Evaluation JSON records the Showdown version and hashes for the candidate, benchmark pool, and installed sandbox mod.

## Dynasty Draft League

`npm run draft-league-v4` runs the persistent multi-season league. The six custom generations used by the draft are stored inside `data/draft`; the league does not depend on sibling output folders.

The default is 10 managers over 8 seasons. Each manager retains up to three Pokemon, learns within bounded personality limits, keeps opponent-specific lineup memory, and writes a checkpoint after every completed season. Set `V4_OUT` to choose the output directory. To extend an existing league, keep the original settings and seed, increase `V4_SEASONS`, and set `V4_RESUME=true`.

V6 supports 6-30 managers. A 30-team league defaults to a 420-species pool, 60 premium auction lots, 24 regular-season rounds, free-agent windows after rounds 8 and 16, and a 12-team playoff. Remaining cash has in-season value and half carries into the next season up to a 20-credit cap. Released players retain their completed stint statistics. The permanent asset ledger records supply, ownership, and market state so changing league size cannot remint an existing scarce asset.

The manager development system starts every manager from the same neutral novice state, shared learning rules, and shared tactical ability. Draft order, market conflicts, opponents, and battle experience create path-dependent strategy posteriors. Those posteriors dynamically produce role priorities, auction economics, and battle temperament for the following season. Style names are generated after the fact from observed development and never control decisions. Each season contributes at most one effective sample per strategy axis, exploration decays to a nonzero floor, and `evolution-summary.json` provides a compact audit surface without loading battle logs into an LLM context. Legendary, Mythical, and each of the 35 custom Pokemon have one persistent league asset; a seeded cohort of elite ordinary species issues one to three independently tracked assets and never exceeds three. Developmental dynasty checkpoints use state version 6 and require an explicit migration from earlier rule states.

```powershell
$env:V4_OUT='output/draft-league-v4'
$env:V4_SEASONS='8'
npm.cmd run draft-league-v4

$env:V4_SEASONS='10'
$env:V4_RESUME='true'
npm.cmd run draft-league-v4
```

To migrate a completed V5 founding season into a 30-team V6 expansion league, copy the league directory for a preview first, then run with the original seed and:

```powershell
$env:V4_MANAGER_LIMIT='30'
$env:V4_POOL_SIZE='420'
$env:V4_AUCTION_LOTS='60'
$env:V4_REGULAR_ROUNDS='24'
$env:V4_RESUME='true'
$env:V4_EXPAND_FROM_V5='true'
npm.cmd run draft-league-v4
```

The migration preserves founding-season history, limits incumbents to two protected contracts, creates 20 neutral novice managers, gives expansion teams a one-season budget credit, and builds the V6 asset ledger from existing `assetId` values.

Checkpoints bind the career to the current TypeScript sources, bundled six-generation data, expanded benchmark pool, dependency lockfile, and Pokemon Showdown version. Resume intentionally fails after any of those inputs changes; start a new output directory for a new rules version.

Sandbox `entry` fields contain trusted JavaScript hooks and are not a security isolation boundary. Do not compile or install untrusted sandbox JSON.

## Outputs

Each simulation writes:

- `teamA.export.txt`, `teamA.json`, `teamA.packed.txt`
- `teamB.export.txt`, `teamB.json`, `teamB.packed.txt`
- `game-0001/raw.log`
- `game-0001/public.log` (one normalized public branch; private `|split|` branches remain only in `raw.log`)
- `game-0001/end.json`
- `summary.json`

Evaluation writes:

- `candidate.export.txt`, `candidate.json`, `candidate.packed.txt`
- `benchmark-pool.json`
- `matchups/<benchmark-id>/game-0001/*`
- `evaluation.json`
- `report.md`

Variant experiments write:

- `baseline/`
- `variants/<variant-id>/candidate.export.txt`
- `variants/<variant-id>/eval/`
- `variants.json`
- `variants-report.md`

Sandbox compile output writes:

- `mod/mythicmons/*.js`
- `config/custom-formats.js`
- `team.export.txt`
- `team.json`
- `team.packed.txt`
- `manifest.json`
