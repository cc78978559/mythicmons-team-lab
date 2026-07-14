import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {cloneTacticalMemory, extractTacticalEpisode, tacticalFamilyValue, tacticalSignals, updateTacticalMemory} from "../draft/tacticalMemory";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-tactical-memory-"));
try {
  const logPath = path.join(root, "public.log");
  fs.writeFileSync(logPath, [
    "|switch|p1a: G5 Cinccino|Mythic Cinccino|354/354",
    "|switch|p2a: Red-Charizard|Mythic Charizard|360/360",
    "|move|p1a: G5 Cinccino|Tail Slap|p2a: Red-Charizard",
    "|faint|p2a: Red-Charizard",
    "|switch|p2a: Red-Pikachu|Mythic Pikachu-Starter|458/458",
    "|move|p2a: Red-Pikachu|Focus Blast|p1a: G5 Cinccino",
    "|-enditem|p1a: G5 Cinccino|Focus Sash",
    "|faint|p1a: G5 Cinccino",
    "|switch|p1a: Bewear|Bewear|444/444",
    "|move|p2a: Red-Pikachu|Volt Tackle|p1a: Bewear",
    "|faint|p1a: Bewear",
    "|turn|4",
    "|win|Team B",
  ].join("\n"), "utf8");
  const episode = extractTacticalEpisode({id: "boss-probe", opponentId: "g1-red", publicLogPath: logPath, perspective: "p1", familyByName: new Map([["g5cinccino", "mythic-g5-cinccino"], ["bewear", "bewear"]])});
  assert.equal(episode.result, "loss");
  assert.equal(episode.opponentLead, "redcharizard");
  assert.ok(episode.ownContributions["mythic-g5-cinccino"] > 0, "a member that secured a key KO must retain positive credit in a loss");
  assert.ok(episode.ownContributions.bewear < 0, "an unproductive faint should receive negative credit");
  assert.ok(episode.decisiveEvents.some(event => event.includes("focussash")));

  const tradeLog = path.join(root, "trade.log");
  fs.writeFileSync(tradeLog, [
    "|switch|p1a: Blissey|Blissey|714/714",
    "|switch|p2a: Red-Snorlax|Mythic Snorlax|574/574",
    "|move|p2a: Red-Snorlax|Self-Destruct|p1a: Blissey",
    "|faint|p2a: Red-Snorlax",
    "|faint|p1a: Blissey",
    "|turn|1",
    "|win|Team B",
  ].join("\n"), "utf8");
  const trade = extractTacticalEpisode({id: "trade-probe", opponentId: "g1-red", publicLogPath: tradeLog, perspective: "p1", familyByName: new Map([["blissey", "blissey"]])});
  assert.ok(trade.ownContributions.blissey > 0, "absorbing a self-KO trade should receive credit rather than a blanket faint penalty");
  assert.ok(trade.decisiveEvents.some(event => event.includes("absorbed-self-ko")));

  const staleMoveLog = path.join(root, "stale-move.log");
  fs.writeFileSync(staleMoveLog, [
    "|switch|p1a: G5 Cinccino|Mythic Cinccino|354/354",
    "|switch|p2a: Red-Blastoise|Mythic Blastoise|452/452",
    "|move|p2a: Red-Blastoise|Water Pulse|p1a: G5 Cinccino",
    "|move|p1a: G5 Cinccino|Bullet Seed|p2a: Red-Blastoise",
    "|faint|p2a: Red-Blastoise",
    "|win|Team A",
  ].join("\n"), "utf8");
  const staleMove = extractTacticalEpisode({id: "stale-move-probe", opponentId: "g1-red", publicLogPath: staleMoveLog, perspective: "p1", familyByName: new Map([["g5cinccino", "mythic-g5-cinccino"]])});
  assert.ok(staleMove.decisiveEvents.some(event => event.includes(":ko:redblastoise:with:bulletseed")));
  assert.equal(staleMove.decisiveEvents.some(event => event.includes("absorbed-self-ko")), false, "a prior ordinary move must not be mistaken for self-KO evidence");

  const memory = updateTacticalMemory(undefined, Array.from({length: 8}, (_, index) => ({...episode, id: `probe-${index}`})), 1);
  assert.ok(tacticalFamilyValue(memory, "g1-red", "mythic-g5-cinccino") > 0);
  assert.ok(tacticalFamilyValue(memory, "g1-red", "bewear") < 0);
  const signals = tacticalSignals(memory, "g1-red");
  assert.equal(signals.opponentLeadConcentration, 1);
  assert.equal(signals.historicalWinRate, 0);
  assert.ok(signals.confidence > 0);
  assert.deepEqual(cloneTacticalMemory(memory), memory);
  console.log("tactical memory smoke passed");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
