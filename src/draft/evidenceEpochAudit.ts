import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch, classifyEvidenceEpoch, sha256, validateEvidenceEpoch, type EvidenceEpoch, type EvidenceEpochCompatibility} from "../showdown/evidenceEpoch";

export interface EvidenceEpochAuditCase {
  file: string;
  compatibility: EvidenceEpochCompatibility;
  formalActivationAllowed: boolean;
  reason: string;
  policySha256: string | null;
  contentSha256: string | null;
  aiVersion: string | null;
  eventViolations: string[];
}

interface EvidenceEpochAuditCache {
  schemaVersion: 1;
  policySha256: string;
  verifyEvents: boolean;
  files: Record<string, {size: number; mtimeMs: number; eventFingerprint: string; case: EvidenceEpochAuditCase}>;
}

export interface EvidenceEpochAuditSummary {
  schemaVersion: 1;
  root: string;
  currentPolicySha256: string;
  files: number;
  cachedFiles: number;
  counts: Record<EvidenceEpochCompatibility, number>;
  formalActivationAllowed: number;
  eventViolations: number;
  requireCurrentPassed: boolean;
  requireFormalContextPassed: boolean;
  artifacts: {summary: string; cases: string; cache: string; report: string};
}

export function auditEvidenceEpochs(rootDirectory: string, outDirectory: string, options: {verifyEvents?: boolean} = {}): {summary: EvidenceEpochAuditSummary; cases: EvidenceEpochAuditCase[]} {
  const root = path.resolve(rootDirectory), out = path.resolve(outDirectory), verifyEvents = options.verifyEvents ?? false;
  fs.mkdirSync(out, {recursive: true});
  const summaryFile = path.join(out, "summary.json"), cacheFile = path.join(out, "evidence-epoch-cache.json"), casesFile = path.join(out, "evidence-epoch-cases.json.gz"), reportFile = path.join(out, "evidence-epoch-report.md");
  const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
  const prior = optional<EvidenceEpochAuditCache>(cacheFile), nextFiles: EvidenceEpochAuditCache["files"] = {}, cases: EvidenceEpochAuditCase[] = [];
  let cachedFiles = 0;
  for (const file of replayCapsules(root)) {
    const relative = path.relative(root, file).replace(/\\/g, "/"), stat = fs.statSync(file), eventFingerprint = verifyEvents ? publicEventFingerprint(file) : "not-checked", cached = prior?.schemaVersion === 1 && prior.policySha256 === currentPolicySha256 && prior.verifyEvents === verifyEvents ? prior.files[relative] : undefined;
    let result: EvidenceEpochAuditCase;
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.eventFingerprint === eventFingerprint) { result = cached.case; cachedFiles += 1; }
    else result = inspectCapsule(file, relative, verifyEvents);
    nextFiles[relative] = {size: stat.size, mtimeMs: stat.mtimeMs, eventFingerprint, case: result}; cases.push(result);
  }
  const counts: EvidenceEpochAuditSummary["counts"] = {"exact-compatible": 0, "transferable-prior": 0, "historical-only": 0, invalid: 0};
  for (const result of cases) counts[result.compatibility] += 1;
  const formalActivationAllowed = cases.filter(result => result.formalActivationAllowed).length, eventViolations = cases.reduce((sum, result) => sum + result.eventViolations.length, 0);
  const summary: EvidenceEpochAuditSummary = {schemaVersion: 1, root, currentPolicySha256, files: cases.length, cachedFiles, counts, formalActivationAllowed, eventViolations, requireCurrentPassed: cases.length > 0 && counts["exact-compatible"] === cases.length && eventViolations === 0, requireFormalContextPassed: cases.length > 0 && formalActivationAllowed === cases.length && eventViolations === 0, artifacts: {summary: summaryFile, cases: casesFile, cache: cacheFile, report: reportFile}};
  atomicJson(cacheFile, {schemaVersion: 1, policySha256: currentPolicySha256, verifyEvents, files: nextFiles} satisfies EvidenceEpochAuditCache);
  fs.writeFileSync(casesFile, zlib.gzipSync(`${JSON.stringify({schemaVersion: 1, cases})}\n`));
  fs.writeFileSync(reportFile, evidenceEpochAuditMarkdown(summary), "utf8");
  atomicJson(summaryFile, summary);
  return {summary, cases};
}

export function classifyReplayEvidence(capsuleFile: string, verifyEvents = false): EvidenceEpochAuditCase {
  return inspectCapsule(path.resolve(capsuleFile), path.resolve(capsuleFile), verifyEvents);
}

function inspectCapsule(file: string, relative: string, verifyEvents: boolean): EvidenceEpochAuditCase {
  try {
    const capsule = readJson<any>(file);
    if (![1, 2].includes(capsule?.schemaVersion) || capsule?.input?.schemaVersion !== capsule.schemaVersion || !/^[a-f0-9]{64}$/.test(String(capsule?.sha256 ?? "")) || sha256(capsule.input) !== capsule.sha256) throw new Error("invalid replay capsule envelope or content hash");
    const epoch = capsule.input.evidenceEpoch as EvidenceEpoch | undefined;
    if (!epoch) return result(relative, "historical-only", false, "legacy replay has no evidence epoch", null, []);
    const validation = validateEvidenceEpoch(epoch);
    if (validation.length) return result(relative, "invalid", false, validation.join("; "), epoch, []);
    const expected = buildEvidenceEpoch(AI_VERSION, epoch.content.format, {registryHash: epoch.content.registryHash, configurationPolicyVersion: epoch.content.configurationPolicyVersion});
    const classification = classifyEvidenceEpoch(epoch, expected), violations = verifyEvents ? inspectPublicEvents(file, epoch) : [];
    return result(relative, violations.length ? "invalid" : classification.compatibility, violations.length ? false : classification.formalActivationAllowed, violations.length ? violations.join("; ") : classification.reason, epoch, violations);
  } catch (error) {
    return result(relative, "invalid", false, error instanceof Error ? error.message : String(error), null, []);
  }
}

function result(file: string, compatibility: EvidenceEpochCompatibility, formalActivationAllowed: boolean, reason: string, epoch: EvidenceEpoch | null, eventViolations: string[]): EvidenceEpochAuditCase {
  return {file, compatibility, formalActivationAllowed, reason, policySha256: epoch?.policySha256 ?? null, contentSha256: epoch?.contentSha256 ?? null, aiVersion: epoch?.battlePolicy.aiVersion ?? null, eventViolations};
}

function inspectPublicEvents(capsuleFile: string, epoch: EvidenceEpoch): string[] {
  const directory = path.dirname(capsuleFile), plain = path.join(directory, "public.log"), compressed = `${plain}.gz`;
  if (!fs.existsSync(plain) && !fs.existsSync(compressed)) return [];
  const log = fs.existsSync(plain) ? fs.readFileSync(plain, "utf8") : zlib.gunzipSync(fs.readFileSync(compressed)).toString("utf8"), violations: string[] = [];
  if (!epoch.battlePolicy.mechanics.terastallization && log.includes("|-terastallize|")) violations.push("terastallization event violates declared policy");
  if (!epoch.battlePolicy.mechanics.dynamax && /\|(?:-start|detailschange)\|[^\n]*(?:Dynamax|Gmax)/i.test(log)) violations.push("dynamax event violates declared policy");
  return violations;
}

function publicEventFingerprint(capsuleFile: string): string {
  const directory = path.dirname(capsuleFile), plain = path.join(directory, "public.log"), compressed = `${plain}.gz`, file = fs.existsSync(plain) ? plain : fs.existsSync(compressed) ? compressed : null;
  if (!file) return "missing";
  const stat = fs.statSync(file); return `${path.basename(file)}:${stat.size}:${stat.mtimeMs}`;
}

function* replayCapsules(directory: string): Generator<string> {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* replayCapsules(target);
    else if (entry.name === "replay-input.json" || entry.name === "replay-input.json.gz") yield target;
  }
}

function readJson<T>(file: string): T { const raw = fs.readFileSync(file); return JSON.parse(file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8")) as T; }
function optional<T>(file: string): T | undefined { try { return readJson<T>(file); } catch { return undefined; } }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8"); fs.renameSync(temporary, file); }
function evidenceEpochAuditMarkdown(summary: EvidenceEpochAuditSummary): string { return [`# Evidence Epoch Audit`, "", `- Files: ${summary.files}`, `- Cache hits: ${summary.cachedFiles}`, `- Current compatible: ${summary.counts["exact-compatible"]}`, `- Transferable prior: ${summary.counts["transferable-prior"]}`, `- Historical only: ${summary.counts["historical-only"]}`, `- Invalid: ${summary.counts.invalid}`, `- Formal activation allowed: ${summary.formalActivationAllowed}`, `- Event violations: ${summary.eventViolations}`, `- Current-era gate: ${summary.requireCurrentPassed ? "pass" : "blocked"}`, `- Formal-context gate: ${summary.requireFormalContextPassed ? "pass" : "blocked"}`, ""].join("\n"); }
