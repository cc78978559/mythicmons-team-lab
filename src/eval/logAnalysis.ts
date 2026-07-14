import fs from "node:fs";
import type {LogAnalysis} from "./types";

const HAZARD_CONDITIONS = new Set([
  "Spikes",
  "Stealth Rock",
  "Toxic Spikes",
  "Sticky Web",
  "move: Spikes",
  "move: Stealth Rock",
  "move: Toxic Spikes",
  "move: Sticky Web",
]);

const HAZARD_DAMAGE_SOURCES = new Set([
  "Spikes",
  "Stealth Rock",
]);

export function analyzePublicLog(
  logPath: string,
  winner: string | null,
  turns: number,
  candidateSide: "p1" | "p2" = "p1",
): LogAnalysis {
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  const analysis = emptyAnalysis();
  let lastP1Attacker = "direct/unknown";
  let lastP2Attacker = "direct/unknown";
  let lastP1Move = "";
  let lastP2Move = "";
  const lastDamageSourceByTarget: Record<string, {side: "p1" | "p2" | "unknown"; name: string}> = {};
  const statusSourceByTarget: Record<string, {side: "p1" | "p2" | "unknown"; name: string}> = {};
  const perishSourceByTarget: Record<string, {side: "p1" | "p2" | "unknown"; name: string}> = {};
  const hazardSourceBySide: Record<"p1" | "p2", Record<string, {side: "p1" | "p2" | "unknown"; name: string}>> = {p1: {}, p2: {}};
  const recentSwitches = new Set<string>();
  let weatherSource: {side: "p1" | "p2" | "unknown"; name: string} | undefined;
  let destinyBondSource: {side: "p1" | "p2" | "unknown"; name: string} | undefined;

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|");
    const event = parts[1];

    if (event === "turn") {
      for (const key of Object.keys(lastDamageSourceByTarget)) delete lastDamageSourceByTarget[key];
      recentSwitches.clear();
      destinyBondSource = undefined;
      continue;
    }

    if (event === "switch" || event === "drag") {
      const switched = parseIdent(parts[2]);
      delete lastDamageSourceByTarget[targetKey(switched)];
      recentSwitches.add(targetKey(switched));
      continue;
    }

    if (event === "move") {
      recentSwitches.clear();
      const actor = parseIdent(parts[2]);
      if (actor.side === "p1") {
        lastP1Attacker = actor.name;
        lastP1Move = parts[3] ?? "";
      }
      if (actor.side === "p2") {
        lastP2Attacker = actor.name;
        lastP2Move = parts[3] ?? "";
      }
      continue;
    }

    if (event === "-damage") {
      const target = parseIdent(parts[2]);
      const source = sourceFromParts(parts);
      const attributed = damageAttribution(
        parts,
        target,
        lastP1Attacker,
        lastP2Attacker,
        statusSourceByTarget[targetKey(target)],
        target.side === "unknown" ? undefined : hazardSourceBySide[target.side],
        weatherSource,
      );
      if (target.side !== "unknown") lastDamageSourceByTarget[targetKey(target)] = attributed;
      if (source && HAZARD_DAMAGE_SOURCES.has(source)) {
        if (target.side === "p1") analysis.p1HazardsTaken += 1;
        if (target.side === "p2") analysis.p2HazardsTaken += 1;
      }
      continue;
    }

    if (event === "-status") {
      const target = parseIdent(parts[2]);
      if (target.side === "p1") analysis.p1StatusesTaken += 1;
      if (target.side === "p2") analysis.p2StatusesTaken += 1;
      const directSource = sourceIdentFromParts(parts);
      const from = sourceFromParts(parts);
      if (target.side !== "unknown") {
        const toxicSpikesSource = recentSwitches.has(targetKey(target)) && ["psn", "tox"].includes(toConditionId(parts[3]))
          ? hazardSourceBySide[target.side].toxicspikes
          : undefined;
        statusSourceByTarget[targetKey(target)] = directSource ?? toxicSpikesSource ?? (from?.startsWith("item:")
          ? target
          : {side: opponentOf(target.side), name: target.side === "p1" ? lastP2Attacker : lastP1Attacker});
        recentSwitches.delete(targetKey(target));
      }
      continue;
    }

    if (event === "-sidestart") {
      const side = parseSide(parts[2]);
      const condition = normalizeCondition(parts[3]);
      if (!HAZARD_CONDITIONS.has(condition)) continue;
      if (side === "p1") increment(analysis.p1SideConditions, condition);
      if (side === "p2") increment(analysis.p2SideConditions, condition);
      if (side !== "unknown") {
        hazardSourceBySide[side][toConditionId(condition)] = sourceIdentFromParts(parts) ?? {
          side: opponentOf(side),
          name: side === "p1" ? lastP2Attacker : lastP1Attacker,
        };
      }
      continue;
    }

    if (event === "-sideend") {
      const side = parseSide(parts[2]);
      const condition = normalizeCondition(parts[3]);
      if (side !== "unknown") delete hazardSourceBySide[side][toConditionId(condition)];
      continue;
    }

    if (event === "-weather") {
      weatherSource = sourceIdentFromParts(parts) ?? weatherSource;
      continue;
    }

    if (event === "-activate" && parts.some(part => part.includes("Destiny Bond"))) {
      destinyBondSource = parseIdent(parts[2]);
      continue;
    }

    if (event === "-start" && parts.some(part => /^perish\d$/i.test(part))) {
      const target = parseIdent(parts[2]);
      perishSourceByTarget[targetKey(target)] = sourceIdentFromParts(parts) ?? {
        side: opponentOf(target.side),
        name: target.side === "p1" ? lastP2Attacker : lastP1Attacker,
      };
      continue;
    }

    if (event === "faint") {
      const fainted = parseIdent(parts[2]);
      let source = lastDamageSourceByTarget[targetKey(fainted)] ?? perishSourceByTarget[targetKey(fainted)];
      if (!source && destinyBondSource && destinyBondSource.side === opponentOf(fainted.side)) source = destinyBondSource;
      const ownLastMove = fainted.side === "p1" ? lastP1Move : lastP2Move;
      if (!source && ["explosion", "selfdestruct", "mistyexplosion", "finalgambit", "memento", "healingwish", "lunardance"].includes(toConditionId(ownLastMove))) {
        source = fainted;
      }
      if (fainted.side === "p2") {
        increment(analysis.p2Faints, fainted.name);
        increment(analysis.p1Kos, creditedName(source, "p1", "p2"));
      } else if (fainted.side === "p1") {
        increment(analysis.p1Faints, fainted.name);
        increment(analysis.p2Kos, creditedName(source, "p2", "p1"));
      }
    }
  }

  const candidateLost = (candidateSide === "p1" && winner === "Team B") || (candidateSide === "p2" && winner === "Team A");
  if (candidateLost) {
    const hazardsTaken = candidateSide === "p1" ? analysis.p1HazardsTaken : analysis.p2HazardsTaken;
    const sideConditions = candidateSide === "p1" ? analysis.p1SideConditions : analysis.p2SideConditions;
    const statusesTaken = candidateSide === "p1" ? analysis.p1StatusesTaken : analysis.p2StatusesTaken;
    const opponentKos = candidateSide === "p1" ? analysis.p2Kos : analysis.p1Kos;
    if (hazardsTaken > 0 || Object.keys(sideConditions).length > 0) {
      analysis.failureSignals["hazard pressure"] = hazardsTaken + countValues(sideConditions);
    }
    if (statusesTaken > 0) {
      analysis.failureSignals["status pressure"] = statusesTaken;
    }
    if (turns <= 20) {
      analysis.failureSignals["early offensive pressure"] = 1;
    }
    if (turns >= 60) {
      analysis.failureSignals["long-game endurance pressure"] = 1;
    }
    for (const [name, count] of Object.entries(opponentKos)) {
      if (count >= 2 && !name.startsWith("uncredited/")) {
        analysis.failureSignals[`swept or cleaned by ${name}`] = count;
      }
    }
  }

  return analysis;
}

function emptyAnalysis(): LogAnalysis {
  return {
    p1Kos: {},
    p2Kos: {},
    p1Faints: {},
    p2Faints: {},
    p1HazardsTaken: 0,
    p2HazardsTaken: 0,
    p1StatusesTaken: 0,
    p2StatusesTaken: 0,
    p1SideConditions: {},
    p2SideConditions: {},
    failureSignals: {},
  };
}

function parseIdent(raw = ""): {side: "p1" | "p2" | "unknown"; name: string} {
  const side = raw.startsWith("p1") ? "p1" : raw.startsWith("p2") ? "p2" : "unknown";
  const name = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : raw.trim();
  return {side, name: name || "unknown"};
}

function parseSide(raw = ""): "p1" | "p2" | "unknown" {
  if (raw.startsWith("p1")) return "p1";
  if (raw.startsWith("p2")) return "p2";
  return "unknown";
}

function normalizeCondition(raw = ""): string {
  return raw.replace(/^\[from\]\s*/, "").trim();
}

function sourceFromParts(parts: string[]): string | null {
  const source = parts.find(part => part.startsWith("[from] "));
  if (!source) return null;
  return source.replace("[from] ", "").replace("move: ", "").trim();
}

function damageAttribution(
  parts: string[],
  target: {side: "p1" | "p2" | "unknown"; name: string},
  lastP1Attacker: string,
  lastP2Attacker: string,
  statusSource: {side: "p1" | "p2" | "unknown"; name: string} | undefined,
  hazardSources: Record<string, {side: "p1" | "p2" | "unknown"; name: string}> | undefined,
  weatherSource: {side: "p1" | "p2" | "unknown"; name: string} | undefined,
): {side: "p1" | "p2" | "unknown"; name: string} {
  const directSource = sourceIdentFromParts(parts);
  if (directSource) return directSource;

  const source = sourceFromParts(parts);
  if (source) {
    const sourceId = toConditionId(source);
    if (["spikes", "stealthrock", "toxicspikes"].includes(sourceId)) {
      return hazardSources?.[sourceId] ?? {side: opponentOf(target.side), name: "indirect/hazard"};
    }
    if (["psn", "tox", "brn"].includes(sourceId)) {
      return statusSource ?? {side: "unknown", name: `indirect/${sourceId}`};
    }
    if (["sandstorm", "hail", "snow"].includes(sourceId)) {
      return weatherSource ?? {side: "unknown", name: `indirect/${sourceId}`};
    }
    if (["recoil", "confusion", "strugglerecoil"].includes(sourceId) || source.startsWith("item:") || source.startsWith("ability:")) {
      return {side: target.side, name: target.name};
    }
  }

  if (target.side === "p2") return {side: "p1", name: lastP1Attacker};
  if (target.side === "p1") return {side: "p2", name: lastP2Attacker};
  return {side: "unknown", name: "indirect/unknown"};
}

function sourceIdentFromParts(parts: string[]): {side: "p1" | "p2" | "unknown"; name: string} | undefined {
  const ofPart = parts.find(part => part.startsWith("[of] "));
  if (!ofPart) return undefined;
  const source = parseIdent(ofPart.replace("[of] ", ""));
  return source.side === "unknown" ? undefined : source;
}

function creditedName(
  source: {side: "p1" | "p2" | "unknown"; name: string} | undefined,
  creditSide: "p1" | "p2",
  faintedSide: "p1" | "p2",
): string {
  if (source?.side === creditSide) return source.name;
  if (source?.side === faintedSide) return "uncredited/self-KO";
  return "uncredited/unknown";
}

function toConditionId(value: string): string {
  return value.replace(/^move:\s*/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function targetKey(target: {side: string; name: string}): string {
  return `${target.side}:${target.name}`;
}

function opponentOf(side: "p1" | "p2" | "unknown"): "p1" | "p2" | "unknown" {
  if (side === "p1") return "p2";
  if (side === "p2") return "p1";
  return "unknown";
}

export function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) increment(target, key, value);
}

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function countValues(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}
