# Stage 6 Delivery: Tool Integration

## Evaluation

Stages 0 through 5 each had specialist commands and healthy artifacts, but operating the chain required remembering six output roots, command names, dependency order, and different meanings of `healthy`. The general tooling doctor also traverses the complete tooling storage tree, which is appropriate for periodic storage maintenance but unnecessarily expensive for everyday AI workflow checks.

## Design

The integrated controller treats each stage as a signed contract with explicit dependencies, artifact state, authority, metrics, and issues. Engineering health, research completion, and formal activation readiness are independent top-level values. Product milestones remain visible after engineering completion, so an inconclusive validation points back to research instead of reporting no next work. Stage 0 remains an audit boundary; the controller cannot silently rebuild league history.

The execution planner is conservative. It skips complete stages, rejects missing upstream dependencies, supports bounded stage ranges and dry runs, writes an atomic run checkpoint, and resumes from the recorded failed stage. A failed target is deliberately allowed through preflight so the controller can repair it; failures before that target remain blockers. Specialist tools remain canonical for stage-specific work.

## Tooling Optimization

Fast status watches summaries, run states, signatures, upstream manifests, round files, signed plans/results, and the implementations that define their meaning. The signed index avoids source traversal and automatically refreshes when a watched file changes. Deep doctor output is compressed, while the normal response contains only stage health and blockers. Full source verification is opt-in and scans the shared Stage-2-to-Stage-4 corpus once.

The general tooling doctor always refreshes the deep pipeline signature before reporting health. Its 18 GB storage index and source-cache reference audit use signed local caches with a 60-minute default TTL; `--refresh-storage` forces a fresh traversal. Cache GC still verifies targets against the workspace boundary before applying removals.

Stage-generation history has a separate simple budget: five complete generations and 512 MB per stage by default. Doctor reports excess history; `tooling cache-gc --apply` removes only the oldest completed generations and always retains the newest complete generation. Moving generations are never GC candidates.

The controller writes `index.json`, `status.json`, `doctor.json`, compressed doctor details, `run-state.json`, `report.md`, and a compact token budget under `output/tooling/ai-pipeline-stage6`.

## Execution

The first real integrated index reports all six stages complete, operational health true, and research completion true. Formal activation remains false for three explicit reasons: the latest official league season is historical under the current evidence epoch, decision dossiers have no current-era formal coverage, and Stage 5 approved no limited-canary domain.

This is the intended distinction. There are no engineering blockers and no next stage to repair, but runtime authority remains unavailable.

Warm `status` completes in about 1.55 seconds including npm and TypeScript launcher startup. Quick in-process doctor takes about 0.37 seconds after startup. The strengthened deep doctor completes in about 4-5 seconds on the reference workspace. Full-source mode completes in about 10-12 seconds and reports 1,413 Stage-1 sources, one shared set of 180 Stage-2-to-Stage-4 sources, and 360 Stage-5 sources, all healthy. A warm general tooling doctor avoids the storage traversal; its remaining time is dominated by the mandatory deep pipeline verification.

The Stage-6 control archive contains seven files and occupies about 23 KB. Its compact full-source summary is estimated at about 439 tokens; detailed specialist output is retained as a 2.4 KB gzip file. A no-op run and a forced Stage-5 dry run both completed without launching expensive work.

## Review

Stage 6 is delivered when fast status, quick doctor, deep specialist doctor, dry-run/no-op execution, resume semantics, index invalidation, unified reporting, and affected tests all pass. Future stages can join by adding one stage contract and specialist command rather than extending several unrelated operator scripts.

Affected-test discovery follows nested `npm run` wrappers to their TypeScript entry points. Runtime changes to the Gen 9 OU benchmark teams and example teams therefore select the simulate, evaluate, and variant smoke workflows that actually consume them, without requiring a full suite.
