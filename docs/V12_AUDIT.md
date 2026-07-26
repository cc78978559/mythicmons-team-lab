# V12 Audit

The V12 auditor separates technical integrity failures from league-health observations. It runs locally and does not call an external model.

## Everyday check

```powershell
npm run audit:v12:quick -- --out output/official-era-03/league
```

Quick mode scans file metadata, rehashes only changed files, and reuses a matching schema-v5 audit summary. A cache hit does not rewrite season reports.

## Full invariant scan

```powershell
npm run audit:v12:full -- --out output/official-era-03/league --progress
```

Full mode rechecks every league invariant while reusing unchanged content hashes. Use it after a completed season or a controlled state change. `--force` is retained as a compatible way to require the invariant scan.

## Forensic scan

```powershell
npm run audit:v12:forensic -- --out output/official-era-03/league --progress
```

Forensic mode rereads and hashes every audit input before running the complete invariant scan. Use it after copying or restoring an archive, after suspected external modification, or for a release boundary.

## What is checked

- Frozen registry and historical checkpoint integrity
- Money conservation, contracts, ownership, and scarce-asset uniqueness
- Strict six-member lineups, roster bounds, generation locks, and configured EV legality
- Strategy-program validity and retained bounded learning evidence
- Expected battle inventory from `battle-archive.json` against actual `end.json` records
- Public battle logs, decision evidence, completion, stalls, timeouts, and protocol errors
- Financial legality and hard-apron violations

League-health warnings remain visible as `metrics.healthWarnings` and in the Markdown report, but do not become technical failures by themselves. Illegal finances remain fatal.

## Outputs and exit status

- `audit-summary.json`: structured result for programs
- `audit-report.md`: compact human-readable report
- `.audit-signature-cache.json`: local incremental file-hash index
- exit `0`: no fatal integrity problem
- exit `2`: one or more fatal integrity problems

Pass `--refresh-reports` to regenerate all season briefs even when quick mode hits the cache. Run `npm run audit:v12 -- --help` for the complete command summary.
