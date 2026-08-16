import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {canonicalJson} from "../showdown/evidenceEpoch";
import type {AiDecisionTrace} from "../showdown/choice";
import type {DecisionRecord} from "./decisionLedger";

export const UNIFIED_DECISION_RECORD_VERSION = "unified-decision-record-v1" as const;

export type UnifiedDecisionDomain = "battle" | "lineup" | "acquire" | "configure" | "research" | "league-operation";
export type DecisionInformationMode = "closed-sheet" | "open-sheet" | "retrospective";

export interface UnifiedDecisionOption {
  id: string;
  score?: number;
  cost?: number;
  rejectedBecause?: string[];
  metrics?: Record<string, unknown>;
}

export interface UnifiedDecisionRecord {
  schemaVersion: 1;
  version: typeof UNIFIED_DECISION_RECORD_VERSION;
  decisionId: string;
  domain: UnifiedDecisionDomain;
  actor: string;
  ordinal: number;
  policy: {id: string; version: string; programId?: string};
  information: {
    mode: DecisionInformationMode;
    timing: "contemporaneous" | "retrospective";
    activationEligible: boolean;
    sources: string[];
  };
  observation: Record<string, unknown>;
  options: UnifiedDecisionOption[];
  selected: string | string[] | null;
  decisionInputSha256: string;
  provenance: Record<string, unknown>;
  postDecision?: Record<string, unknown>;
  sha256: string;
}

export interface UnifiedDecisionInput {
  decisionId: string;
  domain: UnifiedDecisionDomain;
  actor: string;
  ordinal: number;
  policy: UnifiedDecisionRecord["policy"];
  information: UnifiedDecisionRecord["information"];
  observation: Record<string, unknown>;
  options: UnifiedDecisionOption[];
  selected: string | string[] | null;
  provenance?: Record<string, unknown>;
  postDecision?: Record<string, unknown>;
}

const forbiddenContemporaneousKeys = new Set([
  "adjudication", "enddata", "future", "opponentteam", "outcome", "rawlog", "replayinput", "teama", "teamb", "winner",
]);

export function buildUnifiedDecisionRecord(input: UnifiedDecisionInput): UnifiedDecisionRecord {
  validateInput(input);
  const information = {...input.information, sources: [...new Set(input.information.sources.map(value => value.trim()).filter(Boolean))].sort()};
  const options = input.options.map(option => clone({...option, rejectedBecause: option.rejectedBecause ? [...option.rejectedBecause] : undefined, metrics: option.metrics ? clone(option.metrics) : undefined}));
  const decisionCore = {decisionId: input.decisionId, domain: input.domain, actor: input.actor, ordinal: input.ordinal, policy: clone(input.policy), information, observation: clone(input.observation), options};
  const core = {schemaVersion: 1 as const, version: UNIFIED_DECISION_RECORD_VERSION, ...decisionCore, selected: clone(input.selected), decisionInputSha256: digest(decisionCore), provenance: clone(input.provenance ?? {}), ...(input.postDecision ? {postDecision: clone(input.postDecision)} : {})};
  const record: UnifiedDecisionRecord = {...core, sha256: digest(core)};
  assertUnifiedDecisionRecord(record);
  return record;
}

export function attachUnifiedDecisionOutcome(record: UnifiedDecisionRecord, postDecision: Record<string, unknown>): UnifiedDecisionRecord {
  assertUnifiedDecisionRecord(record);
  return buildUnifiedDecisionRecord({...record, provenance: record.provenance, postDecision: {...(record.postDecision ?? {}), ...postDecision}});
}

export function buildBattleDecisionRecords(traces: readonly AiDecisionTrace[], input: {battleId: string; aiVersion: string; openTeamSheets: boolean; replayInputSha256?: string; outcome?: Record<string, unknown>}): UnifiedDecisionRecord[] {
  return traces.map((trace, index) => buildUnifiedDecisionRecord({
    decisionId: `${input.battleId}:${trace.playerId}:${trace.decisionOrdinal ?? index + 1}`,
    domain: "battle",
    actor: trace.playerId,
    ordinal: trace.decisionOrdinal ?? index + 1,
    policy: {id: trace.strategy, version: input.aiVersion, programId: trace.personalityId},
    information: {
      mode: input.openTeamSheets ? "open-sheet" : "closed-sheet",
      timing: "contemporaneous",
      activationEligible: true,
      sources: ["own-private-request", "public-battle-protocol", "prior-opponent-model", ...(input.openTeamSheets ? ["declared-open-team-sheet"] : [])],
    },
    observation: {
      turn: trace.turn,
      battleContext: trace.battleContext ?? null,
      positionSnapshot: trace.positionSnapshot ?? null,
      relationalSnapshot: trace.relationalSnapshot ?? null,
      opponentModel: trace.opponentModel,
      actionTargets: trace.actionTargets ?? {},
    },
    options: trace.candidates.map(candidate => ({
      id: candidate.choice,
      score: candidate.score,
      metrics: {expected: candidate.expected, downside: candidate.downside, worst: candidate.worst, baseScore: candidate.baseScore, personalityAdjustment: candidate.personalityAdjustment},
    })),
    selected: trace.selected,
    provenance: {kind: "battle-ai-trace", battleId: input.battleId, legacyDecisionOrdinal: trace.decisionOrdinal ?? index + 1, ...(input.replayInputSha256 ? {replayInputSha256: input.replayInputSha256} : {})},
    postDecision: input.outcome,
  }));
}

export function buildLeagueDecisionRecords(records: readonly DecisionRecord[], policyVersion: string): UnifiedDecisionRecord[] {
  return records.map(record => buildUnifiedDecisionRecord({
    decisionId: `league:${record.id}`,
    domain: record.domain ?? leagueDomain(record.stage),
    actor: record.actor,
    ordinal: record.sequence,
    policy: {id: `league-${record.stage}`, version: policyVersion},
    information: {mode: "retrospective", timing: "retrospective", activationEligible: false, sources: ["league-decision-ledger", "post-season-audit"]},
    observation: {decision: record.decision, context: record.context, rationale: record.rationale},
    options: leagueOptions(record.alternatives),
    selected: record.selected,
    provenance: {kind: "league-decision-ledger", legacyId: record.id, stage: record.stage, links: record.links},
    postDecision: record.outcome,
  }));
}

export function assertUnifiedDecisionRecord(record: UnifiedDecisionRecord): void {
  if (record.schemaVersion !== 1 || record.version !== UNIFIED_DECISION_RECORD_VERSION) throw new Error("Unsupported unified decision record");
  const {sha256, ...core} = record;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error(`Unified decision record signature mismatch: ${record.decisionId}`);
  const decisionCore = decisionInputProjection(record);
  if (!hex(record.decisionInputSha256) || digest(decisionCore) !== record.decisionInputSha256) throw new Error(`Unified decision input signature mismatch: ${record.decisionId}`);
  validateInput(record);
}

export function decisionInputProjection(record: UnifiedDecisionRecord): Omit<UnifiedDecisionInput, "selected" | "provenance" | "postDecision"> {
  return clone({decisionId: record.decisionId, domain: record.domain, actor: record.actor, ordinal: record.ordinal, policy: record.policy, information: record.information, observation: record.observation, options: record.options});
}

export function writeUnifiedDecisionRecords(file: string, records: readonly UnifiedDecisionRecord[]): void {
  records.forEach(assertUnifiedDecisionRecord);
  const payload = Buffer.from(canonicalJson({schemaVersion: 1, version: UNIFIED_DECISION_RECORD_VERSION, records}));
  const bytes = file.endsWith(".gz") ? zlib.gzipSync(payload, {level: 1}) : payload;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}

export function readUnifiedDecisionRecords(file: string): UnifiedDecisionRecord[] {
  const bytes = fs.readFileSync(file), payload = file.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes, parsed = JSON.parse(payload.toString("utf8")) as {schemaVersion: number; version: string; records: UnifiedDecisionRecord[]};
  if (parsed.schemaVersion !== 1 || parsed.version !== UNIFIED_DECISION_RECORD_VERSION || !Array.isArray(parsed.records)) throw new Error(`Invalid unified decision archive: ${file}`);
  parsed.records.forEach(assertUnifiedDecisionRecord);
  return parsed.records;
}

function validateInput(input: UnifiedDecisionInput): void {
  if (!input.decisionId.trim() || !input.actor.trim() || !Number.isInteger(input.ordinal) || input.ordinal < 1) throw new Error("Incomplete unified decision identity");
  if (!["battle", "lineup", "acquire", "configure", "research", "league-operation"].includes(input.domain)) throw new Error(`Invalid unified decision domain: ${input.decisionId}`);
  if (!input.policy.id.trim() || !input.policy.version.trim() || !Array.isArray(input.options) || !Array.isArray(input.information.sources)) throw new Error(`Incomplete unified decision input: ${input.decisionId}`);
  if (new Set(input.options.map(option => option.id)).size !== input.options.length || input.options.some(option => !option.id.trim())) throw new Error(`Invalid unified decision options: ${input.decisionId}`);
  if (input.options.some(option => option.score !== undefined && !Number.isFinite(option.score) || option.cost !== undefined && !Number.isFinite(option.cost))) throw new Error(`Non-finite unified decision option: ${input.decisionId}`);
  if (input.information.timing === "contemporaneous") {
    if (!["closed-sheet", "open-sheet"].includes(input.information.mode) || !input.information.activationEligible) throw new Error(`Invalid contemporaneous information boundary: ${input.decisionId}`);
    if (input.information.mode === "open-sheet" && !input.information.sources.includes("declared-open-team-sheet") || input.information.mode === "closed-sheet" && input.information.sources.includes("declared-open-team-sheet")) throw new Error(`Team-sheet source disagrees with information mode: ${input.decisionId}`);
    if (input.domain === "battle" && typeof input.selected === "string" && !input.options.some(option => option.id === input.selected)) throw new Error(`Selected battle action is absent from options: ${input.decisionId}`);
    const leaks = forbiddenPaths(input.observation);
    if (leaks.length) throw new Error(`Forbidden contemporaneous decision input: ${leaks.join(", ")}`);
  } else if (input.information.timing !== "retrospective" || input.information.mode !== "retrospective" || input.information.activationEligible) throw new Error(`Invalid retrospective information boundary: ${input.decisionId}`);
}

function forbiddenPaths(value: unknown, prefix = "observation"): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => forbiddenPaths(entry, `${prefix}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const result: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const current = `${prefix}.${key}`;
    if (forbiddenContemporaneousKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) result.push(current);
    result.push(...forbiddenPaths(child, current));
  }
  return result;
}

function leagueDomain(stage: DecisionRecord["stage"]): UnifiedDecisionDomain {
  if (stage === "lineup") return "lineup";
  if (["auction", "draft", "waiver"].includes(stage)) return "acquire";
  if (stage === "battle" || stage === "playoff") return "battle";
  if (stage === "review") return "research";
  return "league-operation";
}

function leagueOptions(alternatives: readonly DecisionRecord["alternatives"][number][]): UnifiedDecisionOption[] {
  const totals = new Map<string, number>(); for (const option of alternatives) totals.set(option.option, (totals.get(option.option) ?? 0) + 1);
  const seen = new Map<string, number>();
  return alternatives.map(option => {
    const ordinal = (seen.get(option.option) ?? 0) + 1; seen.set(option.option, ordinal);
    return {id: (totals.get(option.option) ?? 0) > 1 ? `${option.option}#${ordinal}` : option.option, score: option.score, cost: option.cost, rejectedBecause: option.rejectedBecause, ...((totals.get(option.option) ?? 0) > 1 ? {metrics: {legacyOption: option.option}} : {})};
  });
}

function digest(value: unknown): string { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function clone<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
