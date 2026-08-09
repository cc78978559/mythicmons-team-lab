# Position Value

Stage 2 estimates pre-action win probability from the visible battle position. It is deliberately separate from action scores: selected actions, candidate values, tactical personality parameters, and terminal information are not model inputs.

## State

`position-snapshot-v1` records remaining Pokemon, aggregate and active HP, status burden, active boosts, hazards, screens, forced-switch state, trapping, weather, and field conditions. Own HP comes from the private Showdown request; opponent HP is the public estimate available at that moment.

Calibration uses same-battle, same-turn snapshots from both players. Their feature difference is divided by two to create exact mirrored perspectives. This removes asynchronous decision-opportunity bias and guarantees that swapping perspectives changes `p` to `1-p`.

## Commands

```powershell
npm run position-value:corpus -- --out output/tooling/position-value-corpus-v1
npm run position-value -- build --source output/tooling/position-value-corpus-v1
npm run position-value -- status
npm run position-value -- doctor --verify-sources
npm run position-value -- estimate --snapshot own.json --opponent-snapshot opponent.json
```

The estimate command requires both snapshots from the same battle turn. A single-side approximation is intentionally not exposed because public/private state timing can introduce systematic calibration bias.

## Authority

The delivered model is shadow-only. Benchmark calibration proves that the value representation contains useful predictive information; it does not authorize the model to choose actions. Formal activation requires current-era official-league coverage and an independent prospective holdout.
