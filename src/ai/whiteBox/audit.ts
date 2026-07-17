import fs from "node:fs";
import path from "node:path";
import {ACQUISITION_SHADOW_PARAMETERS, BATTLE_SHADOW_PARAMETERS, BID_SHADOW_PARAMETERS, EVOLUTION_SHADOW_PARAMETERS, KEEPER_SHADOW_PARAMETERS, LEARNING_SHADOW_PARAMETERS, LINEUP_SHADOW_PARAMETERS, MARKET_FLOW_SHADOW_PARAMETERS, MEMORY_SHADOW_PARAMETERS, REGISTRATION_SHADOW_PARAMETERS, type WhiteBoxNumberParameter} from "./parameters";

export interface WhiteBoxAuditIssue {severity: "fatal" | "warning"; code: string; message: string; source?: string}
export interface WhiteBoxAuditSummary {
  schemaVersion: 1;
  root: string;
  files: number;
  records: number;
  expectedTraces: number;
  auditedTraces: number;
  coverage: number;
  fatalCount: number;
  warningCount: number;
  issues: WhiteBoxAuditIssue[];
  metrics: {byDomain: Record<string, number>; comparisons: number; agreements: number; disagreements: number; agreementRate: number; hardRejections: number; cappedUpdates: number; clippedMutations: number; parameterValues: number; auditBytes: number};
  promotion: "blocked" | "needs-review" | "shadow-stable";
}

type RecordLike = {stage?: string; decision?: string; context?: Record<string, any>};
const parameterDefinitions = new Map<string, WhiteBoxNumberParameter>([
  BATTLE_SHADOW_PARAMETERS, LINEUP_SHADOW_PARAMETERS, KEEPER_SHADOW_PARAMETERS, ACQUISITION_SHADOW_PARAMETERS,
  REGISTRATION_SHADOW_PARAMETERS, BID_SHADOW_PARAMETERS, MARKET_FLOW_SHADOW_PARAMETERS, LEARNING_SHADOW_PARAMETERS,
  EVOLUTION_SHADOW_PARAMETERS, MEMORY_SHADOW_PARAMETERS,
].flatMap(registry => registry.allDefinitions()).map(definition => [definition.id, definition]));

export function auditWhiteBoxOutput(rootDirectory: string): WhiteBoxAuditSummary {
  const root = path.resolve(rootDirectory), sources: Array<{source: string; records: RecordLike[]}> = [];
  const statePath = path.join(root, "dynasty-state.json");
  if (fs.existsSync(statePath)) {
    const state = read<{decisionRecords?: RecordLike[]}>(statePath);
    sources.push({source: path.relative(root, statePath), records: state.decisionRecords ?? []});
  }
  const seasonDirectories = fs.existsSync(root) ? fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory() && /^season-\d+$/.test(entry.name)).map(entry => path.join(root, entry.name)) : [];
  if (!seasonDirectories.length && fs.existsSync(path.join(root, "decision-ledger.json"))) seasonDirectories.push(root);
  for (const directory of seasonDirectories.sort()) {
    const file = path.join(directory, "decision-ledger.json");
    if (fs.existsSync(file)) sources.push({source: path.relative(root, file) || "decision-ledger.json", records: read<{records: RecordLike[]}>(file).records});
  }
  return auditWhiteBoxRecords(sources, root);
}

export function auditWhiteBoxRecords(sources: Array<{source: string; records: RecordLike[]}>, root = "in-memory"): WhiteBoxAuditSummary {
  const issues: WhiteBoxAuditIssue[] = [], byDomain: Record<string, number> = {};
  let expectedTraces = 0, auditedTraces = 0, comparisons = 0, agreements = 0, hardRejections = 0, cappedUpdates = 0, clippedMutations = 0, parameterValues = 0, auditBytes = 0;
  const add = (severity: WhiteBoxAuditIssue["severity"], code: string, message: string, source?: string) => issues.push({severity, code, message, source});
  for (const source of sources) for (const [recordIndex, record] of source.records.entries()) {
    const location = `${source.source}#${recordIndex + 1}`;
    expectedTraces += expectedForRecord(record, location, add);
    walk(record.context, value => {
      if (!isTrace(value)) return;
      auditedTraces += 1; auditBytes += Buffer.byteLength(JSON.stringify(value));
      const domain = classify(value); byDomain[domain] = (byDomain[domain] ?? 0) + 1;
      validateFinite(value, location, add);
      if (value.parameters) parameterValues += validateParameters(value.parameters, location, add);
      if (value.comparison) {comparisons += 1; if (value.comparison.agrees) agreements += 1; else {add("warning", "shadow-disagreement", `${value.comparison.incumbent} != ${value.comparison.shadow}`, location);}}
      hardRejections += Number(value.hardRejectedCount ?? 0) + (Array.isArray(value.hardRejections) && value.hardRejections.length ? 1 : 0);
      if (domain === "bid") validateBid(value, location, add);
      if (domain === "market-flow" && value.accepted !== (value.hardRejections.length === 0)) add("fatal", "market-acceptance-drift", "accepted flag disagrees with hard rejections", location);
      if (domain === "trade-assist" && value.recommended !== (value.hardRejections.length === 0)) add("fatal", "trade-assist-gate-drift", "recommended flag disagrees with hard rejections", location);
      if (domain === "learning") {cappedUpdates += value.traits.filter((entry: any) => entry.capped).length; validateLearning(value, location, add);}
      if (domain === "evolution") {clippedMutations += value.mutation.changes.filter((entry: any) => entry.clipped).length; validateEvolution(value, location, add);}
      if (domain === "memory-posterior" && JSON.stringify(value.rollback) !== JSON.stringify(value.before)) add("fatal", "rollback-drift", "configuration rollback differs from before state", location);
    });
  }
  if (!auditedTraces && sources.some(source => source.records.length)) add("fatal", "no-whitebox-traces", "No white-box traces were found");
  const coverage = expectedTraces ? Math.min(1, auditedTraces / expectedTraces) : auditedTraces ? 1 : 0;
  if (expectedTraces && auditedTraces < expectedTraces) add("fatal", "missing-whitebox-traces", `${auditedTraces}/${expectedTraces} expected traces found`);
  const disagreements = comparisons - agreements, agreementRate = comparisons ? agreements / comparisons : 1;
  const fatalCount = issues.filter(issue => issue.severity === "fatal").length, warningCount = issues.length - fatalCount;
  const promotion = fatalCount || coverage < .98 ? "blocked" : agreementRate < .98 ? "needs-review" : "shadow-stable";
  return {schemaVersion: 1, root, files: sources.length, records: sources.reduce((sum, source) => sum + source.records.length, 0), expectedTraces, auditedTraces, coverage, fatalCount, warningCount, issues, metrics: {byDomain, comparisons, agreements, disagreements, agreementRate, hardRejections, cappedUpdates, clippedMutations, parameterValues, auditBytes}, promotion};
}

export function whiteBoxAuditMarkdown(summary: WhiteBoxAuditSummary): string {
  const m = summary.metrics;
  return [`# 白箱 AI 审计`, "", `- 结论：${summary.promotion}`, `- 文件/记录：${summary.files}/${summary.records}`, `- 追踪覆盖：${summary.auditedTraces}/${summary.expectedTraces}（${(summary.coverage * 100).toFixed(1)}%）`, `- 影子一致：${m.agreements}/${m.comparisons}（${(m.agreementRate * 100).toFixed(1)}%）`, `- 致命/警告：${summary.fatalCount}/${summary.warningCount}`, `- 参数值：${m.parameterValues}`, `- 硬拒绝：${m.hardRejections}`, `- 学习限幅/进化截断：${m.cappedUpdates}/${m.clippedMutations}`, `- 审计载荷：${(m.auditBytes / 1024).toFixed(1)} KB`, "", "## 领域", "", ...Object.entries(m.byDomain).sort().map(([domain, count]) => `- ${domain}: ${count}`), "", "## 问题", "", ...(summary.issues.length ? summary.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.code}${issue.source ? ` ${issue.source}` : ""}：${issue.message}`) : ["未发现问题。"]), ""].join("\n");
}

function expectedForRecord(record: RecordLike, source: string, add: (severity: "fatal" | "warning", code: string, message: string, source?: string) => void): number {
  const context = record.context ?? {}; let expected = 0;
  if (record.stage === "auction" && Array.isArray(context.bids)) for (const bid of context.bids) {expected += 1;if (!bid.whiteBox) add("fatal", "missing-bid-trace", "Auction bid lacks white-box trace", source);}
  for (const key of ["whiteBoxShadow", "whiteBoxPriority", "whiteBoxTarget", "whiteBoxAction", "whiteBoxReplacement", "whiteBoxTradeAssist", "learningWhiteBoxTrace", "keeperWhiteBoxShadow", "whiteBoxEvolutionTrace", "whiteBoxMemoryTrace"]) if (context[key]) expected += 1;
  if (Array.isArray(context.updates)) for (const update of context.updates) if (update.kind === "move" || update.kind === "item") {expected += 2;if (!update.whiteBoxEvidence || !update.whiteBoxPosterior) add("fatal", "missing-configuration-trace", `${update.kind}:${update.id ?? "unknown"} lacks evidence or posterior trace`, source);}
  if (Array.isArray(context.signals) && !context.learningWhiteBoxTrace) add("fatal", "missing-learning-trace", "Season learning record lacks trace", source);
  if (Array.isArray(context.mutations) && context.previousLineage && !context.whiteBoxEvolutionTrace) add("fatal", "missing-evolution-trace", "Evolution record lacks trace", source);
  if (typeof context.episodes === "number" && Array.isArray(context.opponents) && !context.whiteBoxMemoryTrace) add("fatal", "missing-memory-trace", "Tactical memory record lacks trace", source);
  return expected;
}

function isTrace(value: any): boolean {return Boolean(value && typeof value === "object" && typeof value.version === "string" && value.version.startsWith("white-box-"));}
function classify(value:any):string {if(value.version==="white-box-bid-v1")return"bid";if(value.version==="white-box-market-flow-v1")return"market-flow";if(value.version==="white-box-trade-assist-v1")return"trade-assist";if(value.version==="white-box-learning-v1")return"learning";if(value.version==="white-box-evolution-v1")return"evolution";if(value.version==="white-box-decision-v1")return"decision";if(value.version==="white-box-memory-v1")return value.posteriorUpdates?"tactical-memory":value.retainedSamples!==undefined?"memory-posterior":value.contributions?"memory-evidence":"memory";return"unknown";}
function walk(value:any,visit:(value:any)=>void):void{if(!value||typeof value!=="object")return;visit(value);if(isTrace(value))return;for(const child of Array.isArray(value)?value:Object.values(value))walk(child,visit);}
function validateFinite(value:any,source:string,add:(severity:"fatal"|"warning",code:string,message:string,source?:string)=>void,pathValue="trace"):void{if(typeof value==="number"&&!Number.isFinite(value)){add("fatal","non-finite-value",pathValue,source);return;}if(!value||typeof value!=="object")return;for(const [key,child] of Object.entries(value))validateFinite(child,source,add,`${pathValue}.${key}`);}
function validateParameters(values:Record<string,number>,source:string,add:(severity:"fatal"|"warning",code:string,message:string,source?:string)=>void):number{let count=0;for(const[id,value]of Object.entries(values)){count++;const definition=parameterDefinitions.get(id);if(!definition)add("fatal","unknown-parameter",id,source);else if(!Number.isFinite(value)||value<definition.minimum||value>definition.maximum)add("fatal","parameter-out-of-range",`${id}=${value} not in ${definition.minimum}..${definition.maximum}`,source);}return count;}
function validateBid(value:any,source:string,add:(severity:"fatal"|"warning",code:string,message:string,source?:string)=>void):void{if(value.bid!==Math.max(0,value.ceiling-value.shade))add("fatal","bid-arithmetic-drift",`${value.bid} != ${value.ceiling}-${value.shade}`,source);if(value.ceiling>value.availableBudget)add("fatal","bid-budget-violation",`${value.ceiling} > ${value.availableBudget}`,source);if(value.hardRejections?.length&&(value.bid!==0||value.ceiling!==0))add("fatal","rejected-positive-bid","Hard-rejected bid is positive",source);}
function validateLearning(value:any,source:string,add:(severity:"fatal"|"warning",code:string,message:string,source?:string)=>void):void{if(value.traits.length!==6)add("fatal","learning-trait-count",String(value.traits.length),source);for(const trait of value.traits){if(JSON.stringify(trait.rollback?.posterior)!==JSON.stringify(trait.prior)||trait.rollback?.trait!==trait.beforeTrait)add("fatal","rollback-drift",trait.trait,source);if(Math.abs(trait.appliedDelta)>value.parameters["learning.maximumtraitdelta"]+1e-12)add("fatal","learning-cap-violation",trait.trait,source);}}
function validateEvolution(value:any,source:string,add:(severity:"fatal"|"warning",code:string,message:string,source?:string)=>void):void{if(value.crossover.triggered!==(value.crossover.draw<value.crossover.threshold&&!value.selection.protectedCopy))add("fatal","crossover-gate-drift",value.eventId,source);for(const gate of value.mutation.gates)if(gate.triggered!==(gate.draw<gate.threshold))add("fatal","mutation-gate-drift",gate.path,source);for(const change of value.mutation.changes)if(change.clipped!==(change.rawAfter!==change.after))add("fatal","mutation-clipping-drift",change.path,source);}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
