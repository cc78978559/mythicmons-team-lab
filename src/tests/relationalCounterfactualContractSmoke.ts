import assert from "node:assert/strict";
import {buildRelationalCounterfactualCorpus, deriveDualHorizonUtility, familySplit, relationalCounterfactualSamples} from "../ai/relationalCounterfactual";
import {buildRelationalDecisionSnapshot, relationalKnownMask, RELATIONAL_SWITCH_FEATURES} from "../ai/relationalDecision";
import type {AiDecisionTrace} from "../showdown/choice";

const candidates = ["switch 2", "switch 3"].map((id, index) => ({
  id,
  actionKind: "switch" as const,
  target: `Pokemon ${index + 2}`,
  values: Object.fromEntries(RELATIONAL_SWITCH_FEATURES.map(feature => [feature, index ? 0.4 : 0.2])) as Record<typeof RELATIONAL_SWITCH_FEATURES[number], number>,
  knownMask: relationalKnownMask(RELATIONAL_SWITCH_FEATURES),
}));
const snapshot = buildRelationalDecisionSnapshot({informationMode: "open-sheet", turn: 4, playerId: "p1", nodes: candidates.map(candidate => ({id: `candidate:${candidate.id}`, kind: "candidate" as const, publicLabel: candidate.target})), edges: [], candidates});
const rows = candidates.map((candidate, index) => ({decisionId: "decision-1", candidateId: candidate.id, familyId: "family-1", clusterId: "cluster-1", environment: "fixture", split: "train" as const, candidate, incumbentSearchScore: index, shortUtility: index ? 0.5 : -0.25, terminalUtility: index ? 1 as const : 0 as const, sourceFingerprint: `${index + 1}`.repeat(64), branchFingerprint: `${index + 3}`.repeat(64)}));
const teacher = {modelSha256: "a".repeat(64), evaluationSha256: "b".repeat(64), authority: "synthetic-test" as const, vsLegacyLogLossPercent: 1, bootstrapProbabilityBetterThanLegacy: 1};

const corpus = buildRelationalCounterfactualCorpus(rows, teacher);
assert.equal(corpus.metrics.decisions, 1);
assert.equal(corpus.metrics.candidates, 2);
assert.equal(relationalCounterfactualSamples(corpus).length, 2);
assert.throws(() => buildRelationalCounterfactualCorpus([...rows, rows[0]], teacher), /duplicated/);
assert.equal(familySplit(["a", "b"], "holdout"), "formal");

const trace = {decisionOrdinal: 1, playerId: "p1", relationalSnapshot: snapshot} as AiDecisionTrace;
assert.deepEqual(deriveDualHorizonUtility({traces: [trace], controlledPlayer: "p1", interventionOrdinal: 1, result: {winner: "Team A", ended: true}, model: {} as never}), {shortUtility: 1, terminalUtility: 1, checkpoint: "terminal"});
const tampered = structuredClone(corpus); tampered.columns.shortUtility[0] = 1;
assert.throws(() => relationalCounterfactualSamples(tampered), /signature mismatch/);

console.log("Relational counterfactual contract smoke passed: signed columns, split boundary, dual-horizon terminal label, and tamper rejection");
