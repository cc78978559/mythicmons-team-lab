import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {buildTacticalTimingArchive, tacticalTimingSummary} from "../ai/whiteBox/tacticalTimingArchive";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-tactical-timing-"));
try {
  const game = path.join(root, "season-22", "battles", "series-1", "left-p1", "game-0001"); fs.mkdirSync(game, {recursive: true});
  const end = {winner: "Team A", turns: 2, p1: "Team A", p2: "Team B", aiProfiles: {p1: "manager-01", p2: "manager-02"}, p1team: team("Alpha"), p2team: team("Beta")};
  const log = ["|switch|p1a: Alpha|Alpha|100/100", "|switch|p2a: Beta|Beta|100/100", "|turn|1", "|move|p1a: Alpha|Tackle|p2a: Beta", "|-damage|p2a: Beta|50/100", "|move|p2a: Beta|Tackle|p1a: Alpha", "|-damage|p1a: Alpha|75/100", "|turn|2", "|move|p1a: Alpha|Tackle|p2a: Beta", "|-damage|p2a: Beta|0 fnt", "|faint|p2a: Beta"].join("\n");
  const candidate = (id: string, score: number) => ({id, eligible: true, reasonable: true, rationalScore: score});
  const decisions = [{turn: 1, playerId: "p1", personalityId: "manager-01", decisionOrdinal: 1, selected: "move tackle", actionTargets: {"move tackle": "tackle"}, whiteBoxShadow: {comparison: {agrees: true}, trace: {candidates: [candidate("move tackle", 10), candidate("switch 2", 9)]}}}];
  fs.writeFileSync(path.join(game, "end.json"), JSON.stringify(end)); fs.writeFileSync(path.join(game, "public.log.gz"), zlib.gzipSync(log)); fs.writeFileSync(path.join(game, "ai-decisions.json.gz"), zlib.gzipSync(JSON.stringify(decisions)));
  const compactGame = path.join(root, "season-22", "battles", "series-2", "left-p1", "game-0001"); fs.mkdirSync(compactGame, {recursive: true});
  fs.writeFileSync(path.join(compactGame, "end.json"), JSON.stringify(end)); fs.writeFileSync(path.join(compactGame, "public.log.gz"), zlib.gzipSync(log));
  fs.writeFileSync(path.join(compactGame, "ai-timing.json.gz"), zlib.gzipSync(JSON.stringify({schemaVersion: 1, samplingFrame: "all-decisions", decisions: [{turn: 1, playerId: "p2", personalityId: "manager-02", decisionOrdinal: 2, selected: "switch 2", margin: 3}]})));
  const archive = buildTacticalTimingArchive(root), row = archive.rows.find(value => value.choice.evidence === "full-trace")!, compact = archive.rows.find(value => value.choice.evidence === "compact-all-decisions")!;
  assert.equal(archive.coverage.decisions, 2); assert.equal(archive.coverage.fullTraceGames, 1); assert.equal(archive.coverage.compactAllDecisionGames, 1); assert.equal(archive.coverage.unmatchedDecisions, 0); assert.equal(row.season, 22); assert.equal(row.context.turn, 1);
  assert.equal(row.context.hpAdvantage, 0); assert.equal(row.choice.kind, "move"); assert.equal(row.choice.evidence, "full-trace"); assert.equal(row.choice.selectionMargin, 1); assert.equal(row.choice.marginBasis, "rational-score"); assert.equal(row.choice.styleChangedRationalWinner, false);
  assert.equal(row.outcome.nextTurn.hpAdvantageDelta, .041666); assert.equal(row.outcome.nextThreeTurns.opponentFaints, 1); assert.equal(row.outcome.won, true);
  assert.equal(Object.prototype.hasOwnProperty.call(row.context, "won"), false); assert.match(archive.causalBoundary.outcome, /activation-ineligible/);
  assert.equal(compact.choice.kind, "switch"); assert.equal(compact.choice.marginBasis, "final-score"); assert.equal(compact.choice.selectionMargin, 3); assert.equal(compact.choice.candidates, null);
  const summary = tacticalTimingSummary(archive) as any; assert.equal(summary.readiness.populationFrameAvailable, true); assert.equal(summary.readiness.currentUse, "prospective-observational-screen"); assert.deepEqual(summary.readiness.blockers, []);
  console.log("Tactical timing archive smoke passed: temporal boundary, choice summary, and 1/3-turn outcomes");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function team(name: string): any[] { return [{name}, ...Array.from({length: 5}, (_, index) => ({name: `${name}-${index + 2}`}))]; }
