import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {loadDynastyState} from "./dynastyStateStore";

export type AuditSeverity = "fatal" | "warning" | "info";

export interface AuditIssue {
  severity: AuditSeverity;
  code: string;
  message: string;
  season?: number;
  managerId?: string;
}

export interface V10AuditSummary {
  schemaVersion: 1;
  generatedAt: string;
  inputSignature: string;
  outputDirectory: string;
  completedSeasons: number;
  managers: number;
  fatalCount: number;
  warningCount: number;
  issues: AuditIssue[];
  metrics: {
    transactions: number;
    trades: number;
    waivers: number;
    rfaDecisions: number;
    hardApronViolations: number;
    floorViolationTeamSeasons: number;
    averagePayroll: number;
    averageDeadMoneyRate: number;
    eliteAssetHhi: number;
    topFourChampionshipShare: number;
    ordinaryUsageRate: number;
    averageUnusedRosterRate: number;
    behaviorSpeciesRange: [number, number];
    moneySupply: number;
    leaguePool: number;
    moneyConserved: boolean;
  };
}

interface StateContract {
  assetId?: string; family: string; pokemon: string; salary: number; yearsRemaining?: number; serviceYears?: number;
  guaranteeRate?: number; status?: string; marketValue?: number;
}

interface DynastyState {
  version: number;
  completedSeason: number;
  managers: Array<{id: string; contracts: StateContract[]; deadMoneyCurrent?: number; deadMoneyNext?: number; seasons: Array<{season: number; champion: boolean}>}>;
  decisionRecords?: Array<{decision?: string}>;
  leaguePool?: number;
  moneySupply?: number;
}

export function auditV10Output(outputDirectory: string): V10AuditSummary {
  const root = path.resolve(outputDirectory);
  const statePath = path.join(root, "dynasty-state.json");
  if (!fs.existsSync(statePath)) throw new Error(`V10 state is missing: ${statePath}`);
  const state = loadDynastyState<DynastyState>(statePath);
  const issues: AuditIssue[] = [];
  if (state.version !== 10) issues.push(issue("fatal", "wrong-state-version", `Expected V10 state, received version ${state.version}`));
  if (!state.managers.length) issues.push(issue("fatal", "empty-league", "The dynasty contains no managers"));
  const moneyTotal = (state.leaguePool ?? 0) + state.managers.reduce((sum, manager) => sum + (manager as any).cash, 0);
  const moneyConserved = Number.isInteger(state.moneySupply) && moneyTotal === state.moneySupply;
  if (!moneyConserved) issues.push(issue("fatal", "money-conservation", `Team cash plus league pool is ${moneyTotal}, expected ${state.moneySupply ?? "missing"}`));

  const retained = new Map<string, string>();
  for (const manager of state.managers) {
    const payroll = manager.contracts.reduce((sum, contract) => sum + contract.salary, 0) + (manager.deadMoneyCurrent ?? 0);
    if (payroll > 120.001) issues.push(issue("fatal", "hard-apron-violation", `Payroll ${payroll.toFixed(2)} exceeds 120`, undefined, manager.id));
    if ((manager.deadMoneyCurrent ?? 0) < 0 || (manager.deadMoneyNext ?? 0) < 0) issues.push(issue("fatal", "negative-dead-money", "Dead money cannot be negative", undefined, manager.id));
    for (const contract of manager.contracts) {
      if (!contract.assetId) issues.push(issue("fatal", "missing-contract-asset", `${contract.pokemon} has no asset id`, undefined, manager.id));
      else if (retained.has(contract.assetId)) issues.push(issue("fatal", "duplicate-retained-asset", `${contract.assetId} is retained by ${retained.get(contract.assetId)} and ${manager.id}`));
      else retained.set(contract.assetId, manager.id);
      if (!Number.isInteger(contract.salary) || contract.salary < 1 || (contract.yearsRemaining ?? 0) < 0 || (contract.guaranteeRate ?? 0) < 0 || (contract.guaranteeRate ?? 0) > 1) issues.push(issue("fatal", "invalid-contract", `${contract.pokemon} has invalid contract fields`, undefined, manager.id));
    }
  }

  let transactions = 0, trades = 0, waivers = 0, hardApronViolations = 0, floorViolationTeamSeasons = 0;
  let payrollTotal = 0, payrollSamples = 0, deadMoneyRateTotal = 0, unusedRateTotal = 0, ordinaryUsed = 0, ordinaryTotal = 0;
  const species: number[] = [];
  const eliteOwners = new Map<string, number>();
  for (let season = 1; season <= state.completedSeason; season += 1) {
    const dir = path.join(root, `season-${String(season).padStart(2, "0")}`);
    for (const required of ["season.json", "health.json", "financial-health.json", "economy.json", "decision-ledger.json", "rosters"]) if (!fs.existsSync(path.join(dir, required))) issues.push(issue("fatal", "missing-season-artifact", `${required} is missing`, season));
    if (!fs.existsSync(path.join(dir, "season.json")) || !fs.existsSync(path.join(dir, "rosters"))) continue;
    const seasonResult = read<{transactions?: Array<{type?: string}>}>(path.join(dir, "season.json"));
    transactions += seasonResult.transactions?.length ?? 0;
    trades += seasonResult.transactions?.filter(entry => entry.type === "trade").length ?? 0;
    waivers += seasonResult.transactions?.filter(entry => entry.type === "waiver").length ?? 0;
    const seen = new Map<string, string>();
    for (const managerId of fs.readdirSync(path.join(dir, "rosters"))) {
      const roster = read<{members: Array<{assetId?: string; scarcity?: string; appearances: number}>}>(path.join(dir, "rosters", managerId, "roster.json"));
      if (roster.members.length < 6 || roster.members.length > 10) issues.push(issue("fatal", "illegal-roster-size", `Roster size ${roster.members.length} is outside 6..10`, season, managerId));
      for (const member of roster.members) {
        if (member.assetId && seen.has(member.assetId)) issues.push(issue("fatal", "duplicate-season-asset", `${member.assetId} appears for ${seen.get(member.assetId)} and ${managerId}`, season));
        else if (member.assetId) seen.set(member.assetId, managerId);
        if (member.scarcity === "standard") { ordinaryTotal += 1; if (member.appearances > 0) ordinaryUsed += 1; }
        if (member.scarcity && member.scarcity !== "standard") eliteOwners.set(managerId, (eliteOwners.get(managerId) ?? 0) + 1);
      }
    }
    if (fs.existsSync(path.join(dir, "health.json"))) {
      const health = read<{unusedRosterRate: number; behaviorSpecies: number; warnings: string[]}>(path.join(dir, "health.json"));
      unusedRateTotal += health.unusedRosterRate;
      species.push(health.behaviorSpecies);
      for (const warning of health.warnings.filter(warning => warning !== "auction-timing-cliff")) issues.push(issue("warning", warning, `League health warning: ${warning}`, season));
    }
    if (fs.existsSync(path.join(dir, "financial-health.json"))) {
      const finance = read<{teams: Array<{payroll: number; deadMoneyCurrent?: number; legal: boolean}>}>(path.join(dir, "financial-health.json"));
      for (const team of finance.teams) {
        payrollTotal += team.payroll; payrollSamples += 1;
        deadMoneyRateTotal += (team.deadMoneyCurrent ?? 0) / 100;
        if (!team.legal) hardApronViolations += 1;
      }
    }
    if (fs.existsSync(path.join(dir, "economy.json"))) {
      const economy = read<{conserved: boolean; totalAfter: number; moneySupply: number}>(path.join(dir, "economy.json"));
      if (!economy.conserved || economy.totalAfter !== economy.moneySupply) issues.push(issue("fatal", "season-money-conservation", `Season economy reports ${economy.totalAfter}/${economy.moneySupply}`, season));
    }
  }
  if (hardApronViolations) issues.push(issue("fatal", "reported-hard-apron-violations", `${hardApronViolations} team-seasons exceeded the hard apron`));
  const rfaDecisions = state.decisionRecords?.filter(record => /RFA|UFA|唯一资产标签/.test(record.decision ?? "")).length ?? 0;
  const championships = state.managers.map(manager => manager.seasons.filter(season => season.champion).length).sort((a, b) => b - a);
  const eliteTotal = [...eliteOwners.values()].reduce((sum, value) => sum + value, 0);
  const eliteAssetHhi = eliteTotal ? [...eliteOwners.values()].reduce((sum, value) => sum + Math.pow(value / eliteTotal, 2), 0) : 0;
  const topFourChampionshipShare = state.completedSeason ? championships.slice(0, 4).reduce((sum, value) => sum + value, 0) / state.completedSeason : 0;
  if (eliteAssetHhi > .12) issues.push(issue("warning", "elite-concentration", `Elite asset HHI is ${eliteAssetHhi.toFixed(3)}`));
  if (state.completedSeason >= 8 && topFourChampionshipShare > .6) issues.push(issue("warning", "championship-concentration", `Top-four championship share is ${(topFourChampionshipShare * 100).toFixed(1)}%`));
  const summary: V10AuditSummary = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), inputSignature: auditInputSignature(root, state.completedSeason), outputDirectory: root,
    completedSeasons: state.completedSeason, managers: state.managers.length,
    fatalCount: issues.filter(entry => entry.severity === "fatal").length, warningCount: issues.filter(entry => entry.severity === "warning").length,
    issues,
    metrics: {transactions, trades, waivers, rfaDecisions, hardApronViolations, floorViolationTeamSeasons, averagePayroll: average(payrollTotal, payrollSamples), averageDeadMoneyRate: average(deadMoneyRateTotal, payrollSamples), eliteAssetHhi, topFourChampionshipShare, ordinaryUsageRate: average(ordinaryUsed, ordinaryTotal), averageUnusedRosterRate: average(unusedRateTotal, state.completedSeason), behaviorSpeciesRange: species.length ? [Math.min(...species), Math.max(...species)] : [0, 0], moneySupply: state.moneySupply ?? 0, leaguePool: state.leaguePool ?? 0, moneyConserved},
  };
  return summary;
}

export function auditInputSignature(root: string, completedSeasons: number): string {
  const hash = crypto.createHash("sha256");
  const files = [path.join(root, "dynasty-state.json")];
  for (let season = 1; season <= completedSeasons; season += 1) for (const name of ["season.json", "health.json", "financial-health.json", "economy.json", "decision-ledger.json"]) files.push(path.join(root, `season-${String(season).padStart(2, "0")}`, name));
  for (const file of files) if (fs.existsSync(file)) { const stat = fs.statSync(file); hash.update(`${path.relative(root, file)}:${stat.size}:${stat.mtimeMs}\n`); }
  return hash.digest("hex");
}

export function auditMarkdown(summary: V10AuditSummary): string {
  const m = summary.metrics;
  const lines = ["# V10 联盟审计", "", `- 赛季：${summary.completedSeasons}`, `- 经理：${summary.managers}`, `- 致命问题：${summary.fatalCount}`, `- 警告：${summary.warningCount}`, `- 交易/waiver：${m.trades}/${m.waivers}`, `- RFA/UFA/标签决策：${m.rfaDecisions}`, `- 平均工资：${m.averagePayroll.toFixed(2)}`, `- 货币守恒：${m.moneyConserved ? "是" : "否"}（总量${m.moneySupply}，联盟池${m.leaguePool}）`, `- 高级资产HHI：${m.eliteAssetHhi.toFixed(3)}`, `- 普通资产使用率：${(m.ordinaryUsageRate * 100).toFixed(1)}%`, "", "## 异常", ""];
  if (!summary.issues.length) lines.push("未发现异常。");
  else for (const entry of summary.issues) lines.push(`- [${entry.severity.toUpperCase()}] ${entry.code}${entry.season ? ` S${entry.season}` : ""}${entry.managerId ? ` ${entry.managerId}` : ""}：${entry.message}`);
  return `${lines.join("\n")}\n`;
}

function issue(severity: AuditSeverity, code: string, message: string, season?: number, managerId?: string): AuditIssue { return {severity, code, message, season, managerId}; }
function average(total: number, count: number): number { return count ? total / count : 0; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
