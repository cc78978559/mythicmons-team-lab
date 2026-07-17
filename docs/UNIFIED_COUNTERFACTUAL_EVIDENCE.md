# Unified counterfactual evidence

The unified evidence planner scans one or more audited dynasty roots without changing league behavior. It combines stored management, lineup, market, and retained battle shadow differences into one deduplicated, stratified catalog.

```powershell
npm run counterfactual:whitebox-unified -- `
  --inputs output/official-era-02/league `
  --out output/official-unified-evidence `
  --max-cases 60 `
  --max-per-domain 10
```

Planning is the default. Cases are classified as:

- `executable`: an isolated replay runner and required gate already exist.
- `requires-gate`: evidence is useful, but the domain still needs a dedicated admission gate or replay route.
- `archive-only`: the stored difference is incomplete or unsupported for intervention.

Run at most one admitted experiment explicitly:

```powershell
npm run counterfactual:whitebox-unified -- `
  --inputs output/official-era-02/league `
  --out output/official-unified-evidence `
  --run `
  --max-experiments 1 `
  --max-output-mb 1024 `
  --min-free-gb 20
```

The manifest is resumable and configuration-bound. Completed branches are compacted with the existing audit-summary retention policy. Failed experiment directories are removed after the failure is recorded. The runner stops before launch when either the output budget or free-disk reserve is exhausted.

Battle evidence is scanned only where full `ai-decisions.json` traces were retained. A source with compact-only battle summaries is marked `battleEvidence: not-retained`; an older trace without white-box fields is marked `legacy-without-whitebox`. Neither state is evidence of agreement.

This is the first unified layer. It does not yet execute lineup, battle, learning, memory, or evolution interventions, and it does not weaken their existing domain-specific gates.
