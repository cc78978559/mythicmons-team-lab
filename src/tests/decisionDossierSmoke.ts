import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildDecisionDossiers, doctorDecisionDossiers, listManagerDossiers, showDecisionDossier} from "../draft/decisionDossierStore";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-decision-dossiers-")), league = path.join(root, "league"), out = path.join(root, "dossiers"), game = path.join(league, "season-01", "battles", "regular", "game-0001");
try {
  fs.mkdirSync(game, {recursive: true});
  const replayInput = {schemaVersion: 1, input: {format: "gen9ou"}} as any;
  replayInput.sha256 = crypto.createHash("sha256").update(canonical(replayInput.input)).digest("hex");
  write(path.join(game, "replay-input.json"), replayInput);
  write(path.join(game, "end.json"), {winner: "Team A", turns: 4, ended: true, timeout: false, adjudication: null, aiDecisionCount: 1, p1: "Team A", p2: "Team B"});
  write(path.join(game, "ai-decisions.json"), [{decisionOrdinal: 1, turn: 2, playerId: "p1", strategy: "search", selected: "move tackle", battleContext: {ownSpecies: "A", opponentSpecies: "B"}, personalityId: "manager-01", opponentModel: {confidence: .2, switchRate: .1, activeSpecies: "B", activeMoveSamples: 3, fallbackMoveSamples: 4}, candidates: [{choice: "move tackle", score: 12, expected: 14, downside: 8, worst: 4, baseScore: 11, personalityAdjustment: 1, responses: []}, {choice: "switch 2", score: 7, expected: 8, downside: 5, worst: 2, baseScore: 7, personalityAdjustment: 0, responses: []}]}]);
  const season = path.join(league, "season-01");
  write(path.join(season, "decision-ledger.json"), {version: 1, records: [{id: "decision-00001", sequence: 1, stage: "draft", actor: "manager-01", decision: "pick", selected: "A", context: {season: 1}, alternatives: [{option: "B", score: 5}], rationale: ["fit"], expectedValue: 7, confidence: .4, links: [], outcome: {wins: 1}}]});
  const first = buildDecisionDossiers({leagueDirectory: league, outputDirectory: out});
  assert.equal(first.sources, 2); assert.equal(first.decisions, 2); assert.equal(first.battleDecisions, 1); assert.equal(first.leagueDecisions, 1); assert.equal(first.healthy, true); assert.equal(first.formalDecisionCoverageReady, false);
  const manager = listManagerDossiers(out, "manager-01"); assert.equal((manager.totals as any).decisions, 2);
  const dossier = (manager.dossiers as any[]).find(value => value.domain === "battle"); assert.equal(dossier.outcome.ownResult, "win"); assert.equal(dossier.scores.margin, 5);
  const hydrated = showDecisionDossier(out, dossier.id, true) as any; assert.equal(hydrated.raw.selected, "move tackle");
  const second = buildDecisionDossiers({leagueDirectory: league, outputDirectory: out}); assert.equal(second.reusedSources, 2); assert.equal(second.rebuiltSources, 0);
  const doctor = doctorDecisionDossiers(out, {verifySources: true}) as any; assert.equal(doctor.healthy, true); assert.equal(doctor.verifiedSources, 2);
  console.log("Decision dossier smoke passed: incremental thin index, source hydration, manager lookup, observational outcomes, and source verification");
} finally { try { fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); } catch { /* Windows may retain a SQLite sidecar until process exit. */ } }

function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
