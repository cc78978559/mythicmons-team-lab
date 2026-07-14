import assert from "node:assert/strict";
import fs from "node:fs";
import {compileSandboxTeam} from "../sandbox/compiler";
import type {SandboxTeam} from "../sandbox/types";

const configs = [
  {file: "data/draft/g1-six-team.json", expectedMembers: 10},
  {file: "data/draft/g2-six-team.json", expectedMembers: 6},
  {file: "data/draft/g3-six-team.json", expectedMembers: 6},
  {file: "data/draft/g4-six-team.json", expectedMembers: 6},
  {file: "data/draft/g5-six-team.json", expectedMembers: 6},
  {file: "data/draft/g6-six-team.json", expectedMembers: 5},
];

for (const {file, expectedMembers} of configs) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SandboxTeam;
  const compiled = compileSandboxTeam(parsed);
  if (compiled.team.length !== expectedMembers) {
    throw new Error(`${file} compiled ${compiled.team.length} members instead of ${expectedMembers}`);
  }
  if (file === "data/draft/g1-six-team.json") {
    assert.equal(parsed.members.some(member => member.id === "g1-wigglytuff"), false, "Retired G1 Wigglytuff must not re-enter the league registry");
    const weezing = parsed.members.find(member => member.id === "g1-weezing");
    assert.deepEqual(weezing?.abilities, ["Levitate", "Neutralizing Gas"]);
    assert.match(compiled.files["abilities.js"], /\["levitate","neutralizinggas"\]/);
    assert.match(compiled.files["scripts.js"], /neutralizinggas && !hasNeutralizingGas/);
  }
  console.log(`${file}: ${compiled.team.length} members, warnings=${compiled.manifest.warnings.length}`);
  for (const warning of compiled.manifest.warnings) console.log(`- ${warning}`);
}
