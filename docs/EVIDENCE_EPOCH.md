# Evidence Epoch And Self-Audit

Stage 0 establishes an explicit authority boundary between historical experience and evidence that may activate an AI policy.

## Signature Model

Every newly written battle replay uses capsule schema 2 and contains an `evidenceEpoch` with two independent signatures:

- `policySha256` binds the AI version, Pokemon Showdown version, state encoder, candidate generator, outcome label, and enabled battle mechanics.
- `contentSha256` binds the effective format, sandbox mod, immutable registry hash, and league configuration policy.
- `epochSha256` binds both layers together.

Mega Evolution remains available through compiled formes. Dynamax and Terastallization are disabled. A formal context additionally requires an immutable registry hash and a configuration policy version.

## Compatibility

- `exact-compatible`: policy and content match. Formal activation still requires a complete formal context.
- `transferable-prior`: the game policy matches but the content boundary differs. It may inform exploration, not activation.
- `historical-only`: the epoch is absent or the battle policy differs.
- `invalid`: signatures disagree or a retained public log contradicts the declared mechanics.

Historical evidence is not deleted and manager memory is not reset. It loses activation authority only.

## Local Commands

```powershell
npm run audit:evidence-epochs -- --root <evidence-root> --verify-events
npm run audit:evidence-epochs -- --root <evidence-root> --require-current
npm run audit:evidence-epochs -- --root <evidence-root> --require-formal-context
npm run audit:v12:quick -- --out <league-root>
npm run league -- doctor --out <league-root>
npm run tooling -- doctor --league <league-root>
```

The generic scanner performs one recursive traversal, caches unchanged capsule results by size and modification time, stores detailed cases as gzip, and prints only a compact summary. The V12 audit performs epoch aggregation inside its existing per-season battle loop, so it does not add a second league traversal.

`league status`, `doctor`, and `resume` reject an audit produced under an obsolete audit/evidence schema. Once the audit is current, historical latest-season evidence is a warning: league continuation remains legal, while formal AI activation remains blocked. Battle and lineup approval files use schema 2 and refuse stale evidence epochs.

## Stage 0 Baseline

The S1-S21 formal archive is technically healthy: 16,150/16,150 battles ended with no protocol failures and no missing battle evidence. All 16,150 replay capsules predate evidence epochs, including all 772 S21 battles. They are therefore historical-only.

The prior battle research portfolio contains 122 physical cases across five research roots. All five roots lack a current epoch binding, so the rebuilt Stage 0 portfolio contains zero active cases. The old artifacts remain available for historical review.

Formal activation can reopen after at least one new season is generated under the current battle policy and immutable registry context, the V12 audit reports every latest-season battle as current and formal, and new research is collected from those signed sources.
