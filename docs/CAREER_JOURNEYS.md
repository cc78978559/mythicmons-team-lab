# Career portraits and inherited journeys

The career archive separates a manager's learned mind from league ownership and season history.

## Build portraits and a memory checkpoint

```powershell
npm.cmd run career:build -- --out output/draft-league-v12-nine-season-valid-no-wigglytuff
```

This writes `career-portraits/`:

- `index.json` and `index.md`: compact 30-manager index.
- `managers/manager-XX.json`: evidence-backed portrait for local queries.
- `managers/manager-XX.md`: evidence-backed first-person career interview, with a manager-specific agenda and unfinished question.
- `narrative-quality.json`: local diversity, evidence coverage, and length audit for all interviews.
- `career-memory.json.gz`: compressed manager minds.
- `career-memory.json`: hash-checked checkpoint manifest.
- `token-budget.json`: files that are safe to read by default.

The checkpoint carries profiles, learned configuration, opponent and tactical memory, strategy programs, and lineage. It does not carry titles, points, cash, contracts, assets, or market ownership.

## Query one manager without loading the league

```powershell
npm.cmd run career:brief -- --out output/draft-league-v12-nine-season-valid-no-wigglytuff --manager 22
```

Add `--full` only when the complete local portrait is required. Do not feed `dynasty-state.json`, full decision ledgers, or battle directories into a model for routine career questions.
The default brief includes the interview but omits the full season and decision ledgers. `token-budget.json` records both default-query and full-portrait upper bounds.

## Start a new journey with inherited minds

Use a new output directory and a new seed:

```powershell
$env:V12_OUT="output/journey-02"
$env:V12_SEED="journey-02"
$env:V12_SEASONS="1"
$env:V12_RESUME="false"
$env:V12_ALLOW_CODE_UPGRADE="true" # required once when league code changed after the source journey
$env:V12_CAREER_CHECKPOINT="output/draft-league-v12-nine-season-valid-no-wigglytuff/career-portraits/career-memory.json"
npm.cmd run draft-league-v12
```

`V12_CAREER_CHECKPOINT` cannot be combined with `V12_RESUME`. Registry, benchmark, dependency, and Pokemon Showdown fingerprints must match. A code-only change requires the existing one-time `V12_ALLOW_CODE_UPGRADE=true` confirmation.

## Evidence retention

V12 defaults to `V12_EVIDENCE_RETENTION=compact`:

- Every battle keeps `end.json` and a compressed public log.
- Playoffs, adjudications, errors, and a deterministic sample retain full evidence.
- Routine battles replace the full search tree with `ai-summary.json`.
- Learning and season reports run before evidence is compacted.

Set `V12_EVIDENCE_RETENTION=full` for a specialized run that requires every raw protocol block and search trace. Adjust the deterministic full-evidence sample with `V12_EVIDENCE_SAMPLE_RATE` from `0` to `1`.
