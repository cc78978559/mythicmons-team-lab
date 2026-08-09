# MythicMons Team Lab - Portable Handoff

## Purpose

This is a local Pokemon Showdown-backed persistent league and auditable AI research laboratory. It delegates battle mechanics to Pokemon Showdown.

The current search AI is `stateful-choice-v16-no-tera-dynamax-v1`. V12 remains the persistent league schema version; it is not the battle-policy version.

## New Computer Setup

Requirements:

- Windows PowerShell
- Node.js 24 recommended; a current Node.js LTS release should also work
- Internet access for the first `npm ci`

Extract the ZIP to a stable directory, preferably:

```text
D:\ProjectHoly\mythicmons-team-lab
```

Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-portable.ps1
```

The script installs locked dependencies, validates all six generation data files, rebuilds the installed G1/G2 sandbox fixture, runs the complete test suite, and performs one sandbox search-AI smoke battle.

## Important Files

- `README.md`: commands and architecture
- `data/teams.json`: local saved-team database
- `data/sandbox/g1.json`: G1 source definition
- `data/sandbox/g2.json`: G2 source definition
- `output/g1/recompiled-current/team.export.txt`: default G1 matrix input
- `output/g2/recompiled-current/team.export.txt`: default G2 matrix input
- `benchmarks/gen9ou/index.json`: modern benchmark pool
- `src/showdown/choice.ts`: AI implementation
- `docs/CURRENT_STATUS_AND_ROADMAP.md`: current product status and delivery gates
- `docs/AI_PIPELINE_CONTROL.md`: Stage 0-6 operator guide
- `PACKAGE-MANIFEST.json`: generated portable file inventory and hashes

## Common Commands

Standard smoke battle:

```powershell
npm run simulate -- --teamA examples/teamA.txt --teamB examples/teamB.txt --ai search --games 2 --out output/local-smoke
```

G1 versus G2 sandbox battle:

```powershell
npm run simulate -- --teamA output/g1/recompiled-current/team.export.txt --teamB output/g2/recompiled-current/team.export.txt --format gen9mythicmonssandbox --no-validate --ai search --games 2 --out output/g1-vs-g2-local
```

List saved teams:

```powershell
npm run team -- list
```

Inspect the league and autonomous-AI research chain without scanning battle logs:

```powershell
npm run league -- status
npm run ai-pipeline -- status
npm run tooling -- doctor
```

Refresh the portable inventory after a release change:

```powershell
npm run package-manifest
```

## Result Trust Rules

- Treat one-game runs as smoke tests only.
- Do not trust strength rankings if `stalled`, `timeouts`, or protocol errors are nonzero.
- Compare teams with the same AI version, opponent pool, format, seed policy, and game count.
- `policyShare` in AI traces is a heuristic search weight, not an empirically calibrated probability.
- V12 is a finite-horizon heuristic search model, not a cloned Showdown-state rollout engine.

## Codex Handoff

The Codex account does not replace the local files. On the new computer, ask Codex to read `HANDOFF.md` and `README.md` before changing the project. Do not copy `.codex` authentication files or caches between computers.

## Package Scope

Included: source, documentation, lock files, benchmarks, examples, team database, six-generation draft definitions, and sandbox definitions.

Excluded: `node_modules`, multi-gigabyte historical battle output, temporary caches, credentials, and machine-specific Codex state.
