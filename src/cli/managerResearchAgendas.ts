import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {buildManagerResearchAgenda, createManagerResearchPolicy, reviewManagerResearchRound, summarizeManagerResearchAgendas, validateManagerResearchAgenda, validateManagerResearchPolicy, type ManagerResearchAgenda, type ManagerResearchOutcome, type ManagerResearchPolicyState, type ResearchHypothesisOption} from "../ai/managerResearchAgenda";
import {validateManagerMechanismLedger, type ManagerMechanismLedger} from "../ai/managerMechanismLedger";
import {loadDynastyState} from "../draft/dynastyStateStore";
import {acquireNamedRunLock} from "../draft/runLock";

const args = process.argv.slice(2), command = args[0] ?? "plan";
if (command === "plan") plan(); else if (command === "show") show(); else if (command === "audit") audit(); else if (command === "review") review(); else usage();

function plan(): void {
  const source = path.resolve(option("--source", "output/official-era-03/league")), ledgerFile = path.resolve(option("--mechanism-ledgers", "output/tooling/manager-mechanism-ledgers/manager-mechanism-ledgers.json.gz"));
  const registryFile = path.resolve(option("--registry", "data/lineup-audit-hypotheses.json")), auditFile = path.resolve(option("--audit", "output/tooling/shadow-lineup-hypotheses/lineup-hypothesis-audit.json"));
  const out = path.resolve(option("--out", "output/tooling/manager-research-agendas")), round = integerOption("--round", 1, 1, 100000), state = loadDynastyState<any>(path.join(source, "dynasty-state.json"));
  const ledgers = readArchive<ManagerMechanismLedger>(ledgerFile), byManager = new Map(ledgers.map(ledger => { validateManagerMechanismLedger(ledger); return [ledger.managerId, ledger]; }));
  const registry = read<any>(registryFile), hypothesisAudit = read<any>(auditFile), findings = new Map((hypothesisAudit.findings ?? []).map((value: any) => [String(value.id), value]));
  const hypotheses: ResearchHypothesisOption[] = (registry.hypotheses ?? []).map((value: any) => ({id: String(value.id), title: String(value.title), observationalCandidate: Boolean((findings.get(String(value.id)) as any)?.observationalCandidate) && value.stage !== "causal-complete", causalConclusion: value.causalEvidence?.conclusion ? String(value.causalEvidence.conclusion) : null}));
  fs.mkdirSync(out, {recursive: true}); const lock = acquireNamedRunLock(out, ".manager-research.lock", {workflow: "manager-research-agenda", round});
  try {
    const policyFile = path.join(out, "research-policies.json.gz"), policies = fs.existsSync(policyFile) ? readArchive<ManagerResearchPolicyState>(policyFile) : (state.managers as any[]).map(manager => createManagerResearchPolicy(String(manager.id)));
    const policyByManager = new Map(policies.map(policy => { validateManagerResearchPolicy(policy); return [policy.managerId, policy]; }));
    const agendas: ManagerResearchAgenda[] = ((state.managers ?? []) as any[]).map((manager: any): ManagerResearchAgenda => {
      const ledger = byManager.get(String(manager.id)); if (!ledger) throw new Error(`Missing manager mechanism ledger: ${manager.id}`);
      const policy = policyByManager.get(String(manager.id)); if (!policy) throw new Error(`Missing manager research policy: ${manager.id}`);
      return buildManagerResearchAgenda(String(manager.id), ledger, hypotheses, round, policy);
    }).sort((left: ManagerResearchAgenda, right: ManagerResearchAgenda) => left.managerId.localeCompare(right.managerId));
    if (agendas.length !== ledgers.length) throw new Error(`Research agenda manager count mismatch: ${agendas.length} != ${ledgers.length}`);
    const payload = Buffer.from(JSON.stringify(agendas), "utf8"), compressed = zlib.gzipSync(payload, {level: 9}), summary = summarizeManagerResearchAgendas(agendas);
    const policyPayload = zlib.gzipSync(Buffer.from(JSON.stringify(policies), "utf8"), {level: 9}), policySnapshot = `research-policies-round-${String(round - 1).padStart(2, "0")}.json.gz`; atomic(policyFile, policyPayload); atomic(path.join(out, policySnapshot), policyPayload);
    const agendaSnapshot = `research-agendas-round-${String(round).padStart(2, "0")}.json.gz`;
    atomic(path.join(out, "research-agendas.json.gz"), compressed); preserveDifferent(path.join(out, agendaSnapshot), compressed); atomic(path.join(out, agendaSnapshot), compressed);
    atomicJson(path.join(out, "summary.json"), summary);
    atomicJson(path.join(out, "manifest.json"), {schemaVersion: 1, activationStatus: "shadow-only", round, managers: agendas.length, inputs: {dynastyState: fingerprint(path.join(source, "dynasty-state.json")), mechanismLedgers: fingerprint(ledgerFile), hypothesisRegistry: fingerprint(registryFile), hypothesisAudit: fingerprint(auditFile), researchPolicies: {file: policySnapshot, sha256: sha(policyPayload), bytes: policyPayload.length}}, archive: {file: agendaSnapshot, sha256: sha(compressed), bytes: compressed.length}});
    atomicJson(path.join(out, "token-budget.json"), {summaryBytes: Buffer.byteLength(JSON.stringify(summary)), estimatedSummaryTokens: Math.ceil(Buffer.byteLength(JSON.stringify(summary)) / 3.5), compressedAgendaBytes: compressed.length});
    console.log(JSON.stringify({...summary, round, out}, null, 2));
  } finally { lock.release(); }
}

function show(): void { const agendas = readArchive<ManagerResearchAgenda>(path.resolve(required("--archive"))), manager = required("--manager"), agenda = agendas.find(value => value.managerId === manager); if (!agenda) throw new Error(`Manager research agenda not found: ${manager}`); validateManagerResearchAgenda(agenda); console.log(JSON.stringify(flag("--full") ? agenda : {managerId: agenda.managerId, round: agenda.round, policy: agenda.policy, selected: agenda.selected, alternatives: agenda.ranked.slice(1, 4).map(value => ({mechanismId: value.mechanismId, intent: value.intent, score: value.score})), deferred: agenda.deferred}, null, 2)); }
function audit(): void { const directory = path.resolve(option("--out", "output/tooling/manager-research-agendas")), manifest = read<any>(path.join(directory, "manifest.json")), archive = fs.readFileSync(path.join(directory, manifest.archive.file)); if (sha(archive) !== manifest.archive.sha256 || archive.length !== manifest.archive.bytes) throw new Error("Manager research agenda archive integrity failure"); const agendas = JSON.parse(zlib.gunzipSync(archive).toString("utf8")) as ManagerResearchAgenda[]; console.log(JSON.stringify({...summarizeManagerResearchAgendas(agendas), round: manifest.round, archiveValid: true}, null, 2)); }
function review(): void {
  const directory = path.resolve(option("--out", "output/tooling/manager-research-agendas")), studies = required("--studies").split(",").filter(Boolean).map(value => path.resolve(value));
  const repairRoundValue = option("--repair-round", ""), repairRound = repairRoundValue ? Number(repairRoundValue) : null, policyFile = path.join(directory, "research-policies.json.gz");
  if (repairRound !== null && (!Number.isInteger(repairRound) || repairRound < 1)) throw new Error("Invalid --repair-round");
  const manifest = repairRound === null ? read<any>(path.join(directory, "manifest.json")) : {round: repairRound}, agendas = repairRound === null ? readArchive<ManagerResearchAgenda>(path.join(directory, manifest.archive.file)) : readArchive<ManagerResearchAgenda>(path.resolve(required("--agenda-archive"))), policies = repairRound === null ? readArchive<ManagerResearchPolicyState>(policyFile) : readArchive<ManagerResearchPolicyState>(path.resolve(required("--policy-archive")));
  if (repairRound === null) { const currentPolicyBytes = fs.readFileSync(policyFile); if (sha(currentPolicyBytes) !== manifest.inputs.researchPolicies.sha256) throw new Error("Research policies changed after agenda planning"); }
  const outcomes = new Map<string, ManagerResearchOutcome>();
  const importRegistryFile = path.resolve(option("--import-registry", "output/tooling/manager-mechanism-ledgers/import-registry.json")), importRegistry = fs.existsSync(importRegistryFile) ? read<any>(importRegistryFile) : null, duplicateOutcomes: Array<{managerId: string; mechanismId: string; choiceId: string; firstStudy: string}> = [];
  for (const study of studies) {
    const summary = read<any>(path.join(study, "causal-summary.json")), mechanismId = String(summary.hypothesisId), causalManifest = read<any>(path.join(study, "causal-manifest.json"));
    const normalizedStudy = path.relative(process.cwd(), study).replaceAll("\\", "/");
    for (const item of causalManifest.items ?? []) { if (item.status !== "complete") continue; const imported = importRegistry?.imports?.[`${mechanismId}:${String(item.id)}`]; if (imported && String(imported.study).replaceAll("\\", "/") !== normalizedStudy) { duplicateOutcomes.push({managerId: String(item.managerId), mechanismId, choiceId: String(item.id), firstStudy: String(imported.study)}); continue; } const causal = item.result?.causal ?? {}, games = Math.max(1, Number(causal.games ?? 0)), outcome: ManagerResearchOutcome = {managerId: String(item.managerId), mechanismId, direction: item.result.direction, expressionRate: Math.min(1, Number(causal.actionDivergences ?? 0) / games), outcomeChangeRate: Math.min(1, Number(causal.outcomeChanges ?? 0) / games)}, key = `${outcome.managerId}:${mechanismId}`; if (outcomes.has(key)) throw new Error(`Duplicate research outcome: ${key}`); outcomes.set(key, outcome); }
  }
  const agendaByManager = new Map(agendas.map(value => [value.managerId, value])), results = policies.map(policy => { const agenda = agendaByManager.get(policy.managerId); if (!agenda) throw new Error(`Missing research agenda during review: ${policy.managerId}`); const matches = agenda.ranked.map(question => outcomes.get(`${policy.managerId}:${question.mechanismId}`)).filter((value): value is ManagerResearchOutcome => Boolean(value)); if (matches.length > 1) throw new Error(`Manager has multiple executed research outcomes in one round: ${policy.managerId}`); return reviewManagerResearchRound(policy, agenda, matches[0]); });
  const nextPolicies = results.map(value => value.policy), payload = zlib.gzipSync(Buffer.from(JSON.stringify(nextPolicies), "utf8"), {level: 9}), round = Number(manifest.round), snapshot = `research-policies-round-${String(round).padStart(2, "0")}.json.gz`;
  if (repairRound !== null) preserveSuperseded(path.join(directory, snapshot));
  atomic(path.join(directory, snapshot), payload); atomic(policyFile, payload);
  const rewards = results.map(value => value.informationReward).filter((value): value is number => value !== null), report = {schemaVersion: 1, activationStatus: "shadow-only", round, repair: repairRound !== null, managers: results.length, executed: results.filter(value => value.executed).length, duplicateOutcomesRejected: duplicateOutcomes.length, duplicates: duplicateOutcomes, firstChoiceExecuted: results.filter(value => value.preferenceRank === 0).length, lowerChoiceExecuted: results.filter(value => value.preferenceRank !== null && value.preferenceRank > 0).length, unexecuted: results.filter(value => !value.executed).length, executedByIntent: Object.fromEntries((["new-causal-test", "replicate-local-benefit", "map-local-failure", "resolve-local-contradiction"] as const).map(intent => [intent, results.filter(value => value.executedIntent === intent).length])), informationReward: {minimum: rewards.length ? Math.min(...rewards) : 0, mean: rewards.length ? rewards.reduce((sum, value) => sum + value, 0) / rewards.length : 0, maximum: rewards.length ? Math.max(...rewards) : 0}, exploration: {minimum: Math.min(...nextPolicies.map(value => value.exploration)), maximum: Math.max(...nextPolicies.map(value => value.exploration)), unique: new Set(nextPolicies.map(value => value.exploration)).size}, policyArchive: {file: snapshot, sha256: sha(payload), bytes: payload.length}};
  const details = results.map((value, index) => ({managerId: policies[index].managerId, executed: value.executed, executedMechanismId: value.executedMechanismId, executedIntent: value.executedIntent, preferenceRank: value.preferenceRank, informationReward: value.informationReward, explorationBefore: policies[index].exploration, explorationAfter: value.policy.exploration}));
  const detailPayload = zlib.gzipSync(Buffer.from(JSON.stringify(details), "utf8"), {level: 9}), detailFile = `review-round-${String(round).padStart(2, "0")}-details.json.gz`;
  const reportFile = path.join(directory, `review-round-${String(round).padStart(2, "0")}.json`), detailPath = path.join(directory, detailFile); if (repairRound !== null) { preserveSuperseded(reportFile); preserveSuperseded(detailPath); }
  atomic(detailPath, detailPayload); atomicJson(reportFile, {...report, detailArchive: {file: detailFile, sha256: sha(detailPayload), bytes: detailPayload.length}}); console.log(JSON.stringify(report, null, 2));
}
function readArchive<T>(file: string): T[] { const value = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")); if (!Array.isArray(value)) throw new Error(`Invalid gzip array: ${file}`); return value; }
function fingerprint(file: string): {file: string; sha256: string; bytes: number} { const bytes = fs.readFileSync(file); return {file: path.relative(process.cwd(), file).replaceAll("\\", "/"), sha256: sha(bytes), bytes: bytes.length}; }
function sha(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function atomicJson(file: string, value: unknown): void { atomic(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")); }
function atomic(file: string, value: Buffer): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
function preserveDifferent(file: string, next: Buffer): void { if (!fs.existsSync(file)) return; const prior = fs.readFileSync(file); if (sha(prior) === sha(next)) return; atomic(`${file.slice(0, -8)}-superseded-${sha(prior).slice(0, 8)}.json.gz`, prior); }
function preserveSuperseded(file: string): void { if (!fs.existsSync(file)) return; const bytes = fs.readFileSync(file), extension = file.endsWith(".json.gz") ? ".json.gz" : path.extname(file), base = file.slice(0, -extension.length); atomic(`${base}-superseded-${sha(bytes).slice(0, 8)}${extension}`, bytes); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value; }
function flag(name: string): boolean { return args.includes(name); }
function usage(): never { console.error("Usage: npm run manager-research -- <plan|show|audit|review> [options]\n  review supports --repair-round N --agenda-archive file.gz --policy-archive file.gz"); process.exit(2); }
