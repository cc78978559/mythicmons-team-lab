# Stage 5 Delivery: Novel Evidence Screening

## Selection

The current Stage-4 generation proposed 35 mechanism keys. The signed selector accepted two and rejected 33 before prospective battles were generated. Four previously rejected mechanisms remain retired; one current candidate was excluded because it had already received formal evaluation. The dominant rejection reasons were insufficient independent manager support, insufficient supports, too few research cases or sources, and observed contradictions.

The two admitted mechanisms were:

- avoid a physical attack when late HP is low and the opponent-structure response delta is high;
- prefer an early switch when opponent-structure response delta is low.

This is a complete-evidence screen. It does not discard managers who contradicted a mechanism and it does not extend an old inconclusive or rejected mechanism merely because more similar samples are available.

## Execution

The frozen run generated 900 prospective battles in the declared `balanced` and `pressure` environments. It extracted 14,601 frontier decisions and replay-screened 100 candidate sources. Ninety-six were eligible and four were conservatively excluded for trace-level replay differences before plan signing.

The plan reserved 96 distinct battles: 48 primaries and 48 diagnostic fallbacks. All 48 primary experiments completed with zero failed attempts, zero fallback selections, zero unresolved failures, and 48 unique source battles. Thirty-five branches changed an outcome or duration. Full doctor verification reproduced all 900 retained source fingerprints with no integrity issue.

| Mechanism | Support | Contradiction | Neutral | Decisive | Holm p | Result |
|---|---:|---:|---:|---:|---:|---|
| Avoid physical attack in low-late-HP/high-response states | 0 | 2 | 22 | 2 | 1.0 | Inconclusive |
| Prefer early switch under low opponent-response delta | 1 | 2 | 21 | 3 | 1.0 | Inconclusive |

Neither mechanism remained positive in both environments, neither reached six decisive winner changes, and neither crossed the corrected statistical threshold. No mechanism is eligible for a limited canary.

## Conclusion

Stage 5 is operationally delivered, while both submitted mechanisms failed the evidence gate. This is the intended distinction: the validation system passed; the hypotheses did not. These mechanisms now return to research history and must not receive mechanical same-family expansion. Stage 4 should choose materially new boundaries or mechanisms using the observed contradiction and sparsity evidence.
