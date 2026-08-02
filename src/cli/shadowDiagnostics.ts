import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {acquireNamedRunLock} from "../draft/runLock";
import {buildShadowExperimentPlan, compactShadowExperimentQueue} from "../ai/whiteBox/shadowExperimentPlanner";

interface Study {id: string; domain: string; samples: number; seeds: number; better: number; neutral: number; worse: number; conclusion: string; metrics: Record<string, unknown>; provenance: string}
interface TraceMetric {
  domain: string; observations: number; agreements: number; disagreements: number; recommended: number;
  candidateCount: number; reasonableCount: number; hardRejectedCount: number; closeMargins: number;
  contributionGroups: Record<string, {observations: number; nonZero: number; absoluteTotal: number}>;
  bySeason: Record<string, {observations: number; disagreements: number}>;
}
interface TradeGate {observations: number; disagreements: number; recommended: number; blockedByMargin: number; blockedByLeftRegression: number; blockedByRightRegression: number; blockedBySignals: number; hardRejections: Record<string, number>}
interface ProgramMetric {candidates: number; applied: number; behaviorDistanceTotal: number; opportunityDistanceTotal: number; choicePotentialTotal: number; entrypoints: Record<string, {candidates: number; nonZeroDistance: number; distanceTotal: number; nonZeroChoice: number; choiceTotal: number}>}

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "diagnose";
const root = process.cwd(), source = path.resolve(option("--source", "output/official-era-03/league"));
const out = path.resolve(option("--out", "output/tooling/shadow-diagnostics")), evidenceFile = path.resolve(option("--evidence", "data/shadow-evidence-registry.json"));
const force = args.includes("--force");
const summaryPath = path.join(out, "shadow-diagnosis-summary.json");
if (!["inventory", "diagnose", "report", "queue"].includes(command)) usage();
if (command === "report") { printExisting(); process.exit(0); }
if (command === "queue") { printQueue(); process.exit(0); }
fs.mkdirSync(out, {recursive: true});
const lock = acquireNamedRunLock(out, ".shadow-diagnostics.lock", {workflow: "shadow-diagnostics", source});
process.once("exit", () => lock.release());
const signature = inputSignature();
if (!force && fs.existsSync(summaryPath)) {
  const cached = read<any>(summaryPath);
  if (cached.inputSignature === signature) { printCompact(cached, true); process.exit(0); }
}

const stateHeader = readStateHeader(path.join(source, "dynasty-state.json")), completedSeason = stateHeader.completedSeason;
const traces = new Map<string, TraceMetric>(), tradeGate: TradeGate = {observations: 0, disagreements: 0, recommended: 0, blockedByMargin: 0, blockedByLeftRegression: 0, blockedByRightRegression: 0, blockedBySignals: 0, hardRejections: {}};
const experimentRows: Array<{domain: string; season: number; actor: string; recordId: string; trace: any}> = [];
const program: ProgramMetric = {candidates: 0, applied: 0, behaviorDistanceTotal: 0, opportunityDistanceTotal: 0, choicePotentialTotal: 0, entrypoints: {}};
let decisionRecords = 0, ledgers = 0;
for (let season = 1; season <= completedSeason; season++) {
  const directory = path.join(source, `season-${String(season).padStart(2, "0")}`), ledgerFile = path.join(directory, "decision-ledger.json");
  if (fs.existsSync(ledgerFile)) { ledgers++; const records = read<any>(ledgerFile).records ?? []; decisionRecords += records.length; for (const record of records) scanRecord(record, season); }
  scanProgram(directory);
}
const studies = read<{schemaVersion: number; studies: Study[]}>(evidenceFile).studies;
const domains = [...traces.values()].map(finalizeTrace).sort((a, b) => b.observations - a.observations);
const experimentPlan = buildShadowExperimentPlan(experimentRows), experimentQueue = compactShadowExperimentQueue(experimentPlan);
const queuePath = path.join(out, "shadow-experiment-queue.json");
writeJson(queuePath, experimentQueue);
const diagnoses = diagnose(domains, studies, tradeGate, program);
const development = developmentEvidence(completedSeason + 1);
const audit = safeRead<any>(path.join(source, "audit-summary.json"));
const details = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), inputSignature: signature, source, completedSeason,
  scan: {ledgers, decisionRecords, battleFiles: audit?.metrics?.battleFiles ?? null, lineups: audit?.metrics?.lineups ?? null, rawBattleLogsRead: 0, rawDecisionExamplesRetained: 0},
  domains, tradeGate: finalizeTradeGate(), programEvolution: finalizeProgram(), development, experimentPlan,
  studies: studies.map(study => ({...study, neutralRate: rate(study.neutral, study.samples), decisiveRate: rate(study.better + study.worse, study.samples)})),
  diagnoses, tokenEfficiency: {rawFilesEmitted: 0, rawDecisionExamplesRetained: 0, compactOnly: true},
};
const summary = {
  schemaVersion: 1, generatedAt: details.generatedAt, inputSignature: signature, source, completedSeason, scan: details.scan,
  domains: domains.map(domain => ({domain: domain.domain, observations: domain.observations, disagreements: domain.disagreements, disagreementRate: domain.disagreementRate, closeMarginRate: domain.closeMarginRate})),
  tradeGate: {observations: details.tradeGate.observations, disagreements: details.tradeGate.disagreements, recommended: details.tradeGate.recommended, blockedRates: details.tradeGate.blockedRates},
  programEvolution: details.programEvolution, development,
  experimentFunnel: {...experimentQueue, cases: undefined},
  studies: details.studies.map((study: any) => ({id: study.id, domain: study.domain, samples: study.samples, seeds: study.seeds, better: study.better, neutral: study.neutral, worse: study.worse, conclusion: study.conclusion})),
  diagnoses, detailsArchive: path.join(out, "shadow-diagnosis-details.json.gz"), experimentQueue: queuePath,
};
writeJson(summaryPath, summary);
fs.writeFileSync(summary.detailsArchive, zlib.gzipSync(Buffer.from(`${JSON.stringify(details)}\n`, "utf8"), {level: 9}));
fs.writeFileSync(path.join(out, "shadow-diagnosis-report.md"), markdown(details), "utf8");
const bytes = fs.statSync(summaryPath).size;
writeJson(path.join(out, "token-budget.json"), {schemaVersion: 1, summaryBytes: bytes, estimatedTokensIfReadWhole: Math.ceil(bytes / 4), recommendedRead: "Use command stdout first; open Markdown sections only when needed.", rawBattleLogsRead: 0});
printCompact(summary, false);

function scanRecord(record: any, season: number): void {
  const context = record.context ?? {};
  if (context.whiteBoxShadow) scanTrace(domainFor(record), context.whiteBoxShadow, season, record);
  if (context.whiteBoxTarget) scanTrace("roster-target", context.whiteBoxTarget, season, record);
  if (context.whiteBoxAction) scanTrace("roster-action", context.whiteBoxAction, season, record);
  if (context.whiteBoxTradeAssist) scanTradeGate(context.whiteBoxTradeAssist);
}

function domainFor(record: any): string {
  if (record.stage === "lineup") return "lineup";
  if (record.stage === "draft") return "acquisition";
  if (record.context?.whiteBoxTradeAssist) return "trade";
  return String(record.stage ?? "management");
}

function scanTrace(domain: string, trace: any, season: number, record: any): void {
  experimentRows.push({domain, season, actor: String(record.actor ?? "unknown"), recordId: String(record.id ?? `record-${experimentRows.length + 1}`), trace});
  const metric = traces.get(domain) ?? {domain, observations: 0, agreements: 0, disagreements: 0, recommended: 0, candidateCount: 0, reasonableCount: 0, hardRejectedCount: 0, closeMargins: 0, contributionGroups: {}, bySeason: {}};
  metric.observations++;
  const agrees = trace.comparison?.agrees ?? same(trace.comparison?.incumbent, trace.comparison?.shadow);
  if (agrees) metric.agreements++; else metric.disagreements++;
  if (trace.recommended) metric.recommended++;
  metric.candidateCount += Number(trace.candidateCount ?? trace.candidates?.length ?? 0);
  metric.reasonableCount += Number(trace.reasonableCount ?? 0); metric.hardRejectedCount += Number(trace.hardRejectedCount ?? 0);
  const ranked = (trace.candidates ?? []).filter((candidate: any) => candidate.eligible !== false).sort((a: any, b: any) => Number(b.finalScore ?? 0) - Number(a.finalScore ?? 0));
  if (ranked.length > 1 && Math.abs(Number(ranked[0].finalScore) - Number(ranked[1].finalScore)) <= .05) metric.closeMargins++;
  const selected = ranked.find((candidate: any) => candidate.id === trace.comparison?.shadow) ?? ranked[0];
  for (const contribution of selected?.contributions ?? []) {
    const group = String(contribution.group ?? contribution.source ?? "unknown"), value = Number(contribution.value ?? 0), row = metric.contributionGroups[group] ?? {observations: 0, nonZero: 0, absoluteTotal: 0};
    row.observations++; if (Math.abs(value) > 1e-9) row.nonZero++; row.absoluteTotal += Math.abs(value); metric.contributionGroups[group] = row;
  }
  const seasonRow = metric.bySeason[String(season)] ?? {observations: 0, disagreements: 0}; seasonRow.observations++; if (!agrees) seasonRow.disagreements++; metric.bySeason[String(season)] = seasonRow;
  traces.set(domain, metric);
}

function scanTradeGate(trace: any): void {
  tradeGate.observations++; const different = !same(trace.incumbent, trace.shadow); if (different) tradeGate.disagreements++; if (trace.recommended) tradeGate.recommended++;
  if (!different) return;
  const parameters = trace.parameters?.trade ?? {}, minimumMargin = Number(parameters.assistminimummargin ?? .25), maximumRegression = Number(parameters.assistmaximumsideregression ?? .25), minimumSignals = Number(parameters.assistminimumsignals ?? 2);
  if (Number(trace.rationalMargin ?? 0) < minimumMargin) tradeGate.blockedByMargin++;
  if (Number(trace.leftSideRegression ?? 0) > maximumRegression) tradeGate.blockedByLeftRegression++;
  if (Number(trace.rightSideRegression ?? 0) > maximumRegression) tradeGate.blockedByRightRegression++;
  if (Number(trace.supportingSignals?.length ?? trace.supportingSignals ?? 0) < minimumSignals) tradeGate.blockedBySignals++;
  for (const reason of trace.hardRejections ?? []) { const category = String(reason).split(":")[0]; tradeGate.hardRejections[category] = (tradeGate.hardRejections[category] ?? 0) + 1; }
}

function scanProgram(directory: string): void {
  const evolution = safeRead<any>(path.join(directory, "evolution.json")); if (evolution?.applied) program.applied++;
  const shadow = safeRead<any>(path.join(directory, "evolution-shadow-candidates.json"));
  for (const candidate of shadow?.candidates ?? []) {
    program.candidates++; program.behaviorDistanceTotal += Number(candidate.programBehaviorDistance ?? 0);
    const opportunity = candidate.programOpportunity ?? {}; program.opportunityDistanceTotal += Number(opportunity.distance ?? 0); program.choicePotentialTotal += Number(opportunity.choicePotential ?? 0);
    for (const [entrypoint, value] of Object.entries<any>(opportunity.byEntrypoint ?? {})) {
      const row = program.entrypoints[entrypoint] ?? {candidates: 0, nonZeroDistance: 0, distanceTotal: 0, nonZeroChoice: 0, choiceTotal: 0}, distance = Number(value.distance ?? 0), choice = Number(value.choicePotential ?? 0);
      row.candidates++; row.distanceTotal += distance; row.choiceTotal += choice; if (distance > 1e-9) row.nonZeroDistance++; if (choice > 1e-9) row.nonZeroChoice++; program.entrypoints[entrypoint] = row;
    }
  }
}

function finalizeTrace(metric: TraceMetric): any {
  const contributionGroups = Object.fromEntries(Object.entries(metric.contributionGroups).map(([key, value]) => [key, {nonZeroRate: rate(value.nonZero, value.observations), meanAbsolute: average(value.absoluteTotal, value.observations)}]));
  const contributionTotal = Object.values<any>(contributionGroups).reduce((total, value) => total + value.meanAbsolute, 0);
  const dominant = Object.entries<any>(contributionGroups).sort((left, right) => right[1].meanAbsolute - left[1].meanAbsolute)[0];
  return {
    domain: metric.domain, observations: metric.observations, agreements: metric.agreements, disagreements: metric.disagreements,
    disagreementRate: rate(metric.disagreements, metric.observations), recommended: metric.recommended,
    averages: {candidates: average(metric.candidateCount, metric.observations), reasonable: average(metric.reasonableCount, metric.observations), hardRejected: average(metric.hardRejectedCount, metric.observations)},
    closeMarginRate: rate(metric.closeMargins, metric.observations),
    contributionGroups,
    dominantContribution: dominant ? {group: dominant[0], meanAbsolute: dominant[1].meanAbsolute, share: rate(dominant[1].meanAbsolute, contributionTotal)} : null,
    seasonRange: seasonRange(metric.bySeason),
  };
}
function finalizeTradeGate(): any { return {...tradeGate, disagreementRate: rate(tradeGate.disagreements, tradeGate.observations), recommendationRate: rate(tradeGate.recommended, tradeGate.observations), blockedRates: {margin: rate(tradeGate.blockedByMargin, tradeGate.disagreements), leftRegression: rate(tradeGate.blockedByLeftRegression, tradeGate.disagreements), rightRegression: rate(tradeGate.blockedByRightRegression, tradeGate.disagreements), signals: rate(tradeGate.blockedBySignals, tradeGate.disagreements)}}; }
function finalizeProgram(): any { return {candidates: program.candidates, applied: program.applied, averages: {behaviorDistance: average(program.behaviorDistanceTotal, program.candidates), opportunityDistance: average(program.opportunityDistanceTotal, program.candidates), choicePotential: average(program.choicePotentialTotal, program.candidates)}, entrypoints: Object.fromEntries(Object.entries(program.entrypoints).map(([key, value]) => [key, {expressionRate: rate(value.nonZeroDistance, value.candidates), choiceExpressionRate: rate(value.nonZeroChoice, value.candidates), meanDistance: average(value.distanceTotal, value.candidates), meanChoicePotential: average(value.choiceTotal, value.candidates)}]))}; }

function diagnose(domains: any[], studies: Study[], trade: TradeGate, programs: ProgramMetric): Array<{domain: string; severity: "high" | "medium" | "low"; failureModes: string[]; evidence: string[]; nextAction: string}> {
  const result: Array<{domain: string; severity: "high" | "medium" | "low"; failureModes: string[]; evidence: string[]; nextAction: string}> = [];
  for (const domain of domains) {
    const modes: string[] = [], evidence: string[] = [];
    if (domain.disagreementRate < .01) modes.push("candidate-collapse");
    else if (domain.disagreementRate < .12) modes.push("low-treatment-contrast");
    if (domain.closeMarginRate > .5) modes.push("weak-score-separation");
    if (domain.dominantContribution?.share > .6) { modes.push("single-proxy-dominance"); evidence.push(`${domain.dominantContribution.group} contributes ${percent(domain.dominantContribution.share)} of selected-score magnitude`); }
    const inactive = Object.entries<any>(domain.contributionGroups).filter(([, value]) => value.nonZeroRate < .1).map(([key]) => key);
    if (inactive.length) { modes.push("inactive-feature-groups"); evidence.push(`Mostly-zero groups: ${inactive.join(", ")}`); }
    evidence.push(`${domain.disagreements}/${domain.observations} formal disagreements`);
    result.push({domain: domain.domain, severity: modes.includes("candidate-collapse") ? "high" : modes.length ? "medium" : "low", failureModes: modes, evidence, nextAction: modes.includes("candidate-collapse") ? "Create bounded disagreement candidates before collecting more seasons." : "Replay only disagreements and label the first affected series."});
  }
  const lineupStudies = studies.filter(study => study.domain === "lineup"), lineupCalibration = lineupStudies.find(study => study.metrics.decisivenessBrier !== undefined);
  if (lineupStudies.length) result.push({domain: "lineup-outcomes", severity: "high", failureModes: ["impact-calibration-failure", "outcome-neutrality"], evidence: [`${sum(lineupStudies, "better")}/${sum(lineupStudies, "neutral")}/${sum(lineupStudies, "worse")} better-neutral-worse`, ...(lineupCalibration ? [`${lineupCalibration.metrics.lossImprovementPercent}% loss improvement below ${lineupCalibration.metrics.requiredLossImprovementPercent}% gate`, `decisiveness Brier ${lineupCalibration.metrics.decisivenessBrier} worse than ${lineupCalibration.metrics.decisivenessBaselineBrier} baseline`] : [])], nextAction: "Improve impact features and outcome localization; do not add more labels with the same feature design."});
  const programStudies = studies.filter(study => study.domain === "program-evolution"), better = sum(programStudies, "better"), neutral = sum(programStudies, "neutral"), worse = sum(programStudies, "worse");
  result.push({domain: "program-evolution-outcomes", severity: "high", failureModes: ["local-objective-mismatch", "environment-sensitivity", "outcome-neutrality"], evidence: [`Across v1-v3: ${better}/${neutral}/${worse} better-neutral-worse`, `${programs.candidates} formal candidates, ${programs.applied} applied`, `Mean formal choice potential ${average(programs.choicePotentialTotal, programs.candidates)}`], nextAction: "Stop mutating score boundaries alone; diagnose which entrypoint can alter a local result before generating a candidate."});
  if (trade.observations) result.push({domain: "trade-gate", severity: "high", failureModes: [trade.recommended ? "sparse-recommendation" : "gate-suppression"], evidence: [`${trade.disagreements}/${trade.observations} alternatives differed`, `${trade.recommended} passed the assist gate`, `${trade.blockedBySignals} lacked enough independent support signals`], nextAction: "Separate candidate generation from safety approval and test close legal disagreements without weakening the live gate."});
  for (const domain of ["tactical-memory", "keeper", "academy-contract"]) {
    const relevant = studies.filter(study => study.domain === domain); if (!relevant.length) continue;
    const current = domain === "tactical-memory" ? relevant.filter(study => !study.conclusion.includes("confidence-floor-activated")) : relevant;
    const b = sum(current, "better"), n = sum(current, "neutral"), w = sum(current, "worse"), explicitlyRejected = current.some(study => study.conclusion.startsWith("rejected-"));
    const outcomeEvidence = current.some(study => study.metrics.outcomeCountsReported === false) ? `${current.reduce((total, study) => total + study.samples, 0)} paired samples reported aggregate competitive regression without a published outcome split` : `${b}/${n}/${w} better-neutral-worse across ${current.reduce((total, study) => total + study.samples, 0)} samples`;
    result.push({domain, severity: w > b || explicitlyRejected ? "high" : "medium", failureModes: [w > b || explicitlyRejected ? "negative-generalization" : "proxy-objective-or-low-power"], evidence: [`Validated studies: ${outcomeEvidence}`], nextAction: domain === "academy-contract" ? "Measure multi-cycle development and retention outcomes separately from treasury savings." : "Keep the incumbent policy and generate a new mechanism-level hypothesis."});
  }
  return result;
}

function developmentEvidence(targetSeason: number): any {
  const configured = option("--development", ""), directory = configured ? path.resolve(configured) : path.resolve(path.dirname(source), `development-season-${targetSeason}`);
  const summary = safeRead<any>(path.join(directory, "development-summary.json"));
  return summary ? {directory, academyMarketPolicy: summary.policy?.academyMarket?.policy ?? null, contracts: {count: summary.contracts?.contracts?.length ?? summary.contracts?.count ?? null, replayPolicy: summary.contracts?.replayRules?.policy ?? null}} : null;
}

function markdown(summary: any): string {
  const lines = ["# Shadow Diagnosis", "", `- Source: \`${summary.source}\``, `- Completed seasons: ${summary.completedSeason}`, `- Decision records scanned: ${summary.scan.decisionRecords}`, `- Raw battle logs read: ${summary.scan.rawBattleLogsRead}`, `- Input signature: \`${summary.inputSignature}\``, "", "## Formal Shadow Inventory", "", "| Domain | Observations | Disagreements | Rate | Close-margin rate |", "|---|---:|---:|---:|---:|"];
  for (const domain of summary.domains) lines.push(`| ${domain.domain} | ${domain.observations} | ${domain.disagreements} | ${percent(domain.disagreementRate)} | ${percent(domain.closeMarginRate)} |`);
  lines.push("", "## Experiment Funnel", "", `- Complete candidate traces: ${summary.experimentPlan.completeTraces}/${summary.experimentPlan.observations}`, `- Observed disagreements: ${summary.experimentPlan.observedDisagreements}`, `- Close agreements: ${summary.experimentPlan.boundaryAgreements}`, `- Bounded ranking flips: ${summary.experimentPlan.boundedFlips}`, `- Replay-ready cases: ${summary.experimentPlan.replayReady}`, `- Blocked by compact trace retention: ${summary.experimentPlan.blockedByIncompleteTrace}`, "", `Compact queue: \`${path.join(out, "shadow-experiment-queue.json")}\``, "");
  lines.push("", "## Program Expression", "", `- Candidates: ${summary.programEvolution.candidates}; applied: ${summary.programEvolution.applied}`, `- Mean behavior distance: ${summary.programEvolution.averages.behaviorDistance}`, `- Mean opportunity distance: ${summary.programEvolution.averages.opportunityDistance}`, `- Mean choice potential: ${summary.programEvolution.averages.choicePotential}`, "", "| Entrypoint | Expression | Choice expression | Mean distance |", "|---|---:|---:|---:|");
  for (const [entrypoint, value] of Object.entries<any>(summary.programEvolution.entrypoints)) lines.push(`| ${entrypoint} | ${percent(value.expressionRate)} | ${percent(value.choiceExpressionRate)} | ${value.meanDistance} |`);
  lines.push("", "## Validated Outcome Studies", "", "| Study | Domain | Better | Neutral | Worse | Conclusion |", "|---|---|---:|---:|---:|---|");
  for (const study of summary.studies) lines.push(`| ${study.id} | ${study.domain} | ${study.better} | ${study.neutral} | ${study.worse} | ${study.conclusion} |`);
  lines.push("", "## Failure Diagnosis", "");
  for (const diagnosis of summary.diagnoses) { lines.push(`### ${diagnosis.domain}`, "", `- Severity: ${diagnosis.severity}`, `- Failure modes: ${diagnosis.failureModes.join(", ") || "none"}`, ...diagnosis.evidence.map((value: string) => `- Evidence: ${value}`), `- Next action: ${diagnosis.nextAction}`, ""); }
  return `${lines.join("\n")}\n`;
}

function printCompact(summary: any, cached: boolean): void {
  const compact = {status: cached ? "cached" : "complete", completedSeason: summary.completedSeason, decisionRecords: summary.scan.decisionRecords, domains: summary.domains.map((domain: any) => ({domain: domain.domain, observations: domain.observations, disagreementRate: domain.disagreementRate})), experimentFunnel: summary.experimentFunnel ? {completeTraces: summary.experimentFunnel.completeTraces, observations: summary.experimentFunnel.observations, boundaryAgreements: summary.experimentFunnel.boundaryAgreements, boundedFlips: summary.experimentFunnel.boundedFlips, replayReady: summary.experimentFunnel.replayReady} : null, highSeverity: summary.diagnoses.filter((item: any) => item.severity === "high").map((item: any) => item.domain), summary: summaryPath, report: path.join(out, "shadow-diagnosis-report.md"), tokenBudget: path.join(out, "token-budget.json")};
  console.log(JSON.stringify(compact, null, 2));
}
function printExisting(): void { if (!fs.existsSync(summaryPath)) throw new Error(`Missing diagnosis summary: ${summaryPath}`); const summary = read<any>(summaryPath); console.log(JSON.stringify({completedSeason: summary.completedSeason, highSeverity: summary.diagnoses.filter((item: any) => item.severity === "high").map((item: any) => item.domain), report: path.join(out, "shadow-diagnosis-report.md"), tokenBudget: path.join(out, "token-budget.json")}, null, 2)); }
function printQueue(): void { const file = path.join(out, "shadow-experiment-queue.json"); if (!fs.existsSync(file)) throw new Error(`Missing experiment queue: ${file}; run diagnose first`); const queue = read<any>(file); console.log(JSON.stringify({observations: queue.observations, completeTraces: queue.completeTraces, observedDisagreements: queue.observedDisagreements, boundaryAgreements: queue.boundaryAgreements, boundedFlips: queue.boundedFlips, replayReady: queue.replayReady, blockers: {incompleteTrace: queue.blockedByIncompleteTrace, noBoundedFlip: queue.blockedByNoBoundedFlip}, nextCases: queue.cases.slice(0, 8).map((entry: any) => ({domain: entry.domain, season: entry.season, actor: entry.actor, kind: entry.kind, finalMargin: entry.finalMargin, replayReady: entry.replayReady, blockers: entry.blockers}))}, null, 2)); }
function inputSignature(): string { const digest = crypto.createHash("sha256"); for (const file of inputFiles()) { const stat = fs.statSync(file); digest.update(path.relative(source, file)).update(String(stat.size)).update(String(stat.mtimeMs)); } digest.update(fs.readFileSync(evidenceFile)); return digest.digest("hex"); }
function inputFiles(): string[] { const files = [path.join(source, "dynasty-state.json"), path.join(source, "audit-summary.json"), evidenceFile].filter(file => fs.existsSync(file)); const completed = readStateHeader(path.join(source, "dynasty-state.json")).completedSeason; for (let season = 1; season <= completed; season++) for (const name of ["decision-ledger.json", "evolution.json", "evolution-shadow-candidates.json"]) { const file = path.join(source, `season-${String(season).padStart(2, "0")}`, name); if (fs.existsSync(file)) files.push(file); } return files.sort(); }
function readStateHeader(file: string): {completedSeason: number} { const descriptor = fs.openSync(file, "r"); try { const buffer = Buffer.alloc(65536), bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0), match = buffer.subarray(0, bytes).toString("utf8").match(/"completedSeason"\s*:\s*(\d+)/); if (!match) throw new Error("Cannot read completedSeason from dynasty state header"); return {completedSeason: Number(match[1])}; } finally { fs.closeSync(descriptor); } }
function seasonRange(rows: Record<string, {observations: number; disagreements: number}>): any { const seasons = Object.keys(rows).map(Number).sort((a, b) => a - b); if (!seasons.length) return null; const first = rows[String(seasons[0])], last = rows[String(seasons.at(-1)!)]; return {first: {season: seasons[0], disagreementRate: rate(first.disagreements, first.observations)}, last: {season: seasons.at(-1), disagreementRate: rate(last.disagreements, last.observations)}}; }
function sum(studies: Study[], key: "better" | "neutral" | "worse"): number { return studies.reduce((total, study) => total + study[key], 0); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function rate(value: number, total: number): number { return total ? round(value / total) : 0; }
function average(value: number, total: number): number { return total ? round(value / total) : 0; }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
function percent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function safeRead<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function usage(): never { console.error("Usage: npm run shadow -- <inventory|diagnose|report|queue> [--source DIR] [--out DIR] [--force]"); process.exit(2); }
