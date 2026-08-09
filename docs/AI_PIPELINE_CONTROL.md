# AI Pipeline Control

Stage 6 provides one control plane for Stages 0 through 5. It does not replace specialist tools; it coordinates them and keeps their authority boundaries visible.

## Commands

```powershell
npm run ai-pipeline -- status
npm run ai-pipeline -- doctor
npm run ai-pipeline -- doctor --deep
npm run ai-pipeline -- doctor --verify-sources
npm run ai-pipeline -- run --dry-run
npm run ai-pipeline -- run --force --dry-run
npm run ai-pipeline -- run
npm run ai-pipeline -- resume
npm run ai-pipeline -- inspect --stage 4
npm run ai-pipeline -- report
```

`status` reads a signed compact index. It checks only the size and modification time of a small watched set; changed inputs trigger an incremental index refresh. It never traverses the league or evidence source trees.

`doctor` checks the six stage contracts in-process, including signed plan/result chains and Stage-4 round files. `--deep` calls every specialist doctor without source traversal. `--verify-sources` deliberately performs the expensive source audits and stores detailed results as gzip while printing a compact summary. The shared Stage-2-to-Stage-4 corpus is read once and checked against all three stage bindings during that pass.

`run` evaluates dependencies and executes only missing, failed, or explicitly forced stages. Healthy stages are skipped. A bare `--force` reruns Stages 1 through 5; a bounded stage range limits that force. Non-dry execution performs a deep preflight before any stage starts. The preflight requires every upstream dependency to be healthy while allowing the repair target and its downstream stages to be missing, failed, or stale. `resume` starts from the failed or interrupted stage recorded in the pipeline run state. Both commands hold a pipeline lock and checkpoint stage completion atomically. Stage 0 is audited rather than rebuilt automatically.

After Stage 5 completes, the controller always writes a signed formal-canary handoff. This is a control artifact, not activation: zero candidates produce `no-candidate`, and a formally eligible mechanism without a signed live adapter produces `adapter-required`.

When forced work reaches Stage 4 or Stage 5 with changed inputs, the active directory remains the stable entry point and the prior generation is moved intact under its `archive/` directory. The stage lock is retained during the handoff. Each move is journaled before and during the handoff; a later run completes an interrupted archive before inspecting the active generation. Missing manifest or freeze anchors with retained artifacts are therefore treated as stale generations rather than fresh directories. Direct stage CLI calls still reject drift unless `--replace-stale` is explicit, so evidence is never silently overwritten.

Archive manifests retain the original active root. Stage-5 source verification remaps signed historical paths into the generation directory, allowing an archived generation to replay and hash its own retained battles after a new active generation is created. Failure control files created during an interrupted handoff are preserved separately under `recovery-controls/`.

A zero child-process exit is necessary but not sufficient for pipeline completion. Every stage must publish a healthy semantic summary, and the pipeline refreshes its stage snapshot after execution before recording the item as complete.

Quick status never trusts a reported formal domain by itself. It reconstructs Stage-5 domain dispositions and experiment counters from the signed freeze, plan, and results; new summaries also carry their own canonical signature.

Stage 4 and Stage 5 input contracts require their complete named input sets, canonical paths, hashes, and byte sizes. Empty or partial self-consistent input maps are blockers. Registry and benchmark assets are watched runtime inputs rather than invisible configuration. New Stage-5 freezes bind every benchmark team file as well as the index. Historical freezes remain auditable, but cannot grant limited-canary authority until rebuilt.

## Status Semantics

- `operationalHealthy`: all stage artifacts are structurally healthy and dependency-compatible.
- `pipelineCycleComplete`: the Stage-0-to-Stage-5 research cycle has completed. The legacy `researchComplete` field remains API-compatible but has the same cycle-completion meaning.
- `researchMaturity`: `candidate-ready`, `iteration-required`, or `blocked`; this prevents a healthy zero-candidate generation from being described as mature autonomous control.
- `formalActivationReady`: current formal league evidence, current decision dossiers, and at least one Stage-5 limited-canary domain all qualify.

`nextStage` is reserved for the first broken engineering stage. `nextMilestones` remains populated after all stages complete: it reports current-era evidence collection, another research iteration, limited canary work, or activation readiness. A negative Stage-5 result therefore cannot appear as a product dead end.

Historical coverage warnings and an inconclusive formal result do not make the engineering pipeline unhealthy. Conversely, a healthy pipeline never implies policy activation.
