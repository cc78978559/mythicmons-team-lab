# Stage 1 Delivery: Decision Dossiers

## Evaluation

The league already preserved rich battle traces and operational decision ledgers, but there was no unified way to ask what one manager saw, what alternatives existed, why a choice won, what happened later, or where the canonical evidence lived. The archive contains 16,150 battle artifacts, so copying all raw candidate frontiers into another report would have created unnecessary storage and review cost.

## Design

Stage 1 uses a rebuildable SQLite index over canonical raw files. Each dossier has a stable content-derived id, actor, stage, selected and runner-up options, scores, compact context, rationale, observational outcome, evidence-era compatibility, source fingerprint, and exact locator. `show --hydrate` verifies the current source hash before returning the original record.

Battle outcomes are deliberately labelled observational. They can support hypothesis generation but do not establish that one decision caused the terminal result. Historical-era dossiers are blocked from formal policy activation.

## Tooling

- `build` performs content-hash incremental indexing and leaves phase, peak RSS, and failures on abnormal termination.
- `status` reads a compact summary without traversing the archive.
- `doctor` checks SQLite integrity, dossier policy, summary binding, evidence policy, and league audit signature.
- `doctor --verify-sources` rehashes every canonical source when a full integrity audit is required.
- `manager` retrieves a bounded manager timeline.
- `show --hydrate` provides lossless single-record inspection.
- The unified tooling doctor now includes decision-dossier health and formal-coverage status.

## Execution

The delivered S1-S21 index contains 171,119 dossiers from 1,413 canonical sources:

- 146,663 battle decisions and 24,456 league-operation decisions
- 30 canonical managers
- 1,392 battles with full tactical traces
- 15,120 battles with key-decision summaries
- 362 battles represented by both sources
- 16,150 distinct represented battles and zero unrepresented battle artifacts
- zero structural anomalies

The full rebuild took about 94 seconds with a peak RSS of about 374 MB. The resulting database is about 222 MB. A no-change rebuild reused all 1,413 sources in about 4.8 seconds with a peak RSS of about 110 MB. Full verification rehashed all 1,413 sources successfully.

## Review

Stage 1 is delivered as an inspection and research foundation. It does not make the AI formally autonomous: all 171,119 indexed decisions belong to the historical evidence era, so `formalDecisionCoverageReady` correctly remains false. The next current-era league run will populate eligible dossiers without changing this schema, while the historical archive remains available as prior experience.
