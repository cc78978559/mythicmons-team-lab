import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {SEASON_BRIEF_CHARACTER_LIMIT, writeSeasonBrief} from "../draft/seasonBrief";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "season-brief-smoke-")), seasonDir = path.join(root, "season-01");
try {
  fs.mkdirSync(path.join(seasonDir, "rosters", "manager-01"), {recursive: true});
  write("season.json", {season: 1, champion: {id: "manager-01", name: "Manager 01"}, registry: {hash: "abc"}, validity: {valid: true, battleLineupSize: 6}, standings: Array.from({length: 30}, (_, index) => ({id: `manager-${index + 1}`, name: `Manager ${index + 1}`, points: 30 - index, pairWins: 30 - index, seriesWins: 20, seriesLosses: 4, seriesDraws: 0, kos: 100 - index})), transactions: Array.from({length: 30}, (_, index) => ({type: "trade", manager: `manager-${index}`, signed: `Pokemon ${index}`, released: `Other ${index}`, round: index})), playoffs: {final: {left: "manager-01", right: "manager-02", leftPairs: 2, rightPairs: 0, games: Array.from({length: 100}, () => ({turns: 99, decisions: "must-not-enter-brief"}))}}});
  write("economy.json", {conserved: true});
  write("evolution.json", {descendants: Array.from({length: 30}, (_, index) => ({slotId: `manager-${index}`, parentSlotId: "manager-01", ecologicalFitness: 1 - index / 100, protectedCopy: false, lineage: {mutations: Array.from({length: 20}, (_, mutation) => `mutation-${mutation}`)}, program: {hash: "a".repeat(64)}}))});
  write("battle-archive.json", {files: 200, compressedBytes: 1234, ratio: .05});
  write("rosters/manager-01/roster.json", {members: Array.from({length: 35}, (_, index) => ({pokemon: `Custom ${index}`, scarcity: "unique-custom", price: index, appearances: 20, kos: index * 3}))});
  const {brief, budget} = writeSeasonBrief(seasonDir, root);
  const serialized = fs.readFileSync(path.join(seasonDir, "season-brief.json"), "utf8");
  assert(serialized.length <= SEASON_BRIEF_CHARACTER_LIMIT);
  assert(!serialized.includes("must-not-enter-brief"));
  assert(brief.truncation.applied);
  assert(Number(brief.truncation.omitted.playoffs) >= 0);
  assert(budget.estimatedInputTokens < 3_000);
  assert.deepEqual(budget.defaultModelInput, ["season-01/season-brief.json"]);
  assert(fs.existsSync(path.join(seasonDir, "season-brief.md")));
  console.log("Compact season brief smoke test passed");
} finally { fs.rmSync(root, {recursive: true, force: true}); }
function write(relative: string, value: unknown): void { const file = path.join(seasonDir, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
