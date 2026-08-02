import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {buildLineupBattleCausalSignature} from "../ai/whiteBox/battleCausalSignature";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-battle-causal-")), control = path.join(root, "control"), experiment = path.join(root, "experiment");
try {
  writeGame(control, "Muk", ["|switch|p2a: Muk|Muk|100/100", "|turn|1", "|move|p2a: Muk|Tackle|p1a: Foe", "|turn|2", "|move|p2a: Muk|Tackle|p1a: Foe"]);
  writeGame(experiment, "Tauros", ["|switch|p2a: Tauros|Tauros|100/100", "|turn|1", "|move|p2a: Tauros|Body Slam|p1a: Foe", "|turn|2", "|move|p2a: Tauros|Tackle|p1a: Foe"]);
  const value = buildLineupBattleCausalSignature(control, experiment, 1, "lineup:series-one:manager-01", "manager-01");
  assert.equal(value.available, true); assert.equal(value.games.length, 1); assert.equal(value.games[0].firstActionDivergence, 0);
  assert.deepEqual(value.games[0].teamDelta, {removed: ["Muk"], added: ["Tauros"]});
  assert.deepEqual(value.games[0].participation, {control: ["Muk"], experiment: ["Tauros"], removedUsed: ["Muk"], addedUsed: ["Tauros"]});
  assert.equal(value.games[0].classification, "trajectory-change-outcome-neutral");
  console.log("Battle causal signature smoke passed: team delta, participation, first divergence, chain, and neutral outcome");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function writeGame(branch: string, member: string, lines: string[]): void {
  const directory = path.join(branch, "season-01", "battles", "series-one", "left-p1", "game-0001"); fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, "end.json"), JSON.stringify({winner: "Team A", turns: 2, aiProfiles: {p1: "opponent", p2: "manager-01"}, p2team: [{name: member}]}));
  fs.writeFileSync(path.join(directory, "public.log.gz"), zlib.gzipSync(Buffer.from(lines.join("\n"))));
}
