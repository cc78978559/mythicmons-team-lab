import fs from "node:fs";
import path from "node:path";

export const SEASON_BRIEF_CHARACTER_LIMIT = 8_000;

export interface SeasonBrief {
  schemaVersion: 1;
  season: number;
  registry: {revision?: string; hash?: string};
  validity: {valid: boolean; battleLineupSize: number};
  champion: {id: string; name: string};
  standings: Array<{rank: number; id: string; name: string; points: number; series: string; kos: number}>;
  playoffs: Array<{stage: string; left: string; right: string; score: string}>;
  customPerformance: Array<{pokemon: string; manager: string; price: number; appearances: number; kos: number; kosPerAppearance: number}>;
  notableTransactions: Array<{type: string; manager?: string; signed?: string; released?: string; round?: number}>;
  evolutionHighlights: Array<{slot: string; parent: string; fitness: number; mutations: string[]; program?: string}>;
  audit: {fatal: number | null; warnings: number | null; moneyConserved: boolean; invalidLineups: number | null};
  storage: {battles: number; compressedLogBytes: number; compressionRatio: number};
  observations: string[];
  detailFiles: Record<string, string>;
  truncation: {applied: boolean; omitted: Record<string, number>};
}

export interface TokenBudgetReport {
  schemaVersion: 1;
  season: number;
  briefCharacters: number;
  characterLimit: number;
  estimatedInputTokens: number;
  recommendedResponseTokens: number;
  estimatedStandardReportTotal: number;
  fullArtifactsRemainLocal: true;
  defaultModelInput: string[];
  excludedByDefault: string[];
}

export function writeSeasonBrief(seasonDirectory: string, leagueRoot = path.dirname(seasonDirectory)): {brief: SeasonBrief; budget: TokenBudgetReport} {
  const seasonDir = path.resolve(seasonDirectory), root = path.resolve(leagueRoot);
  const season = read<any>(path.join(seasonDir, "season.json"));
  const economy = optional<any>(path.join(seasonDir, "economy.json"));
  const evolution = optional<any>(path.join(seasonDir, "evolution.json"));
  const archive = optional<any>(path.join(seasonDir, "battle-archive.json"));
  const auditCandidate = optional<any>(path.join(root, "audit-summary.json"));
  const audit = auditCandidate?.completedSeasons >= Number(season.season) ? auditCandidate : null;
  const standings = [...(season.standings ?? [])].sort((a, b) => b.points - a.points || b.pairWins - a.pairWins || a.id.localeCompare(b.id));
  const allCustom = customPerformance(seasonDir);
  const observations = statisticalObservations(allCustom, season, economy);
  const brief: SeasonBrief = {
    schemaVersion: 1,
    season: Number(season.season),
    registry: {hash: season.registry?.hash, revision: registryRevision(root, season.registry?.hash)},
    validity: {valid: Boolean(season.validity?.valid), battleLineupSize: Number(season.validity?.battleLineupSize ?? 0)},
    champion: season.champion,
    standings: standings.slice(0, 8).map((entry, index) => ({rank: index + 1, id: entry.id, name: entry.name, points: entry.points, series: `${entry.seriesWins}-${entry.seriesLosses}-${entry.seriesDraws}`, kos: entry.kos})),
    playoffs: compactPlayoffs(season.playoffs),
    customPerformance: allCustom,
    notableTransactions: (season.transactions ?? []).slice(0, 10).map((entry: any) => ({type: String(entry.type ?? "transaction"), manager: entry.manager, signed: entry.signed, released: entry.released, round: entry.round})),
    evolutionHighlights: (evolution?.descendants ?? []).filter((entry: any) => !entry.protectedCopy).sort((a: any, b: any) => b.ecologicalFitness - a.ecologicalFitness).slice(0, 10).map((entry: any) => ({slot: entry.slotId, parent: entry.parentSlotId, fitness: round(entry.ecologicalFitness, 3), mutations: (entry.lineage?.mutations ?? []).slice(0, 6), program: entry.program?.hash?.slice(0, 12)})),
    audit: {fatal: audit?.fatalCount ?? null, warnings: audit?.warningCount ?? null, moneyConserved: economy?.conserved !== false, invalidLineups: audit?.metrics?.invalidLineups ?? null},
    storage: {battles: Number(archive?.battles ?? Math.floor(Number(archive?.files ?? 0) / 2)), compressedLogBytes: Number(archive?.compressedBytes ?? 0), compressionRatio: round(Number(archive?.ratio ?? 0), 4)},
    observations,
    detailFiles: {season: relative(root, path.join(seasonDir, "season.json")), decisions: relative(root, path.join(seasonDir, "decision-ledger.json")), review: relative(root, path.join(seasonDir, "season-review.md")), evolution: relative(root, path.join(seasonDir, "evolution.json")), audit: "audit-summary.json"},
    truncation: {applied: false, omitted: {}},
  };
  enforceCharacterLimit(brief);
  const serialized = `${JSON.stringify(brief)}\n`;
  if (serialized.length > SEASON_BRIEF_CHARACTER_LIMIT) throw new Error(`Season brief exceeds ${SEASON_BRIEF_CHARACTER_LIMIT} characters after truncation`);
  fs.writeFileSync(path.join(seasonDir, "season-brief.json"), serialized, "utf8");
  fs.writeFileSync(path.join(seasonDir, "season-brief.md"), markdown(brief), "utf8");
  const budget: TokenBudgetReport = {
    schemaVersion: 1, season: brief.season, briefCharacters: serialized.length, characterLimit: SEASON_BRIEF_CHARACTER_LIMIT,
    estimatedInputTokens: estimateTokens(serialized), recommendedResponseTokens: 800,
    estimatedStandardReportTotal: estimateTokens(serialized) + 800, fullArtifactsRemainLocal: true,
    defaultModelInput: [relative(root, path.join(seasonDir, "season-brief.json"))],
    excludedByDefault: [relative(root, path.join(seasonDir, "season.json")), relative(root, path.join(seasonDir, "decision-ledger.json")), `${relative(root, path.join(seasonDir, "battles"))}/**`],
  };
  fs.writeFileSync(path.join(seasonDir, "token-budget.json"), `${JSON.stringify(budget, null, 2)}\n`, "utf8");
  return {brief, budget};
}

function customPerformance(seasonDir: string): SeasonBrief["customPerformance"] {
  const root = path.join(seasonDir, "rosters"), result: SeasonBrief["customPerformance"] = [];
  if (!fs.existsSync(root)) return result;
  for (const manager of fs.readdirSync(root).sort()) {
    const roster = read<any>(path.join(root, manager, "roster.json"));
    for (const member of roster.members ?? []) if (member.scarcity === "unique-custom") result.push({pokemon: member.pokemon, manager, price: Number(member.price ?? 0), appearances: Number(member.appearances ?? 0), kos: Number(member.kos ?? 0), kosPerAppearance: round(member.appearances ? member.kos / member.appearances : 0, 2)});
  }
  return result.sort((a, b) => b.kos - a.kos || a.pokemon.localeCompare(b.pokemon));
}
function compactPlayoffs(playoffs: any): SeasonBrief["playoffs"] {
  const result: SeasonBrief["playoffs"] = [];
  for (const [stage, value] of Object.entries(playoffs ?? {})) for (const series of Array.isArray(value) ? value : value ? [value] : []) result.push({stage, left: series.left, right: series.right, score: `${series.leftPairs}-${series.rightPairs}${series.splitPairs ? `-${series.splitPairs} split` : ""}`});
  return result;
}
function statisticalObservations(custom: SeasonBrief["customPerformance"], season: any, economy: any): string[] {
  const result: string[] = [];
  if (!season.validity?.valid || season.validity?.battleLineupSize !== 6) result.push("TECHNICAL: season is not a valid strict 6v6 sample");
  if (economy?.conserved === false) result.push("TECHNICAL: money conservation failed");
  const productive = custom.filter(entry => entry.appearances > 0), rates = productive.map(entry => entry.kosPerAppearance).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
  for (const entry of productive.filter(entry => entry.appearances >= 10 && entry.kosPerAppearance > Math.max(2, median * 1.75)).slice(0, 5)) result.push(`STATISTICAL: ${entry.pokemon} recorded ${entry.kosPerAppearance} KOs per appearance across ${entry.appearances} appearances`);
  return result;
}
function enforceCharacterLimit(brief: SeasonBrief): void {
  const original = {transactions: brief.notableTransactions.length, evolution: brief.evolutionHighlights.length, standings: brief.standings.length, custom: brief.customPerformance.length, observations: brief.observations.length, playoffs: brief.playoffs.length};
  const size = () => JSON.stringify(brief).length + 1;
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.evolutionHighlights.length > 4) brief.evolutionHighlights.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.notableTransactions.length > 4) brief.notableTransactions.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.standings.length > 5) brief.standings.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.customPerformance.length > 20) brief.customPerformance.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.observations.length > 5) brief.observations.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.evolutionHighlights.length) brief.evolutionHighlights.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.notableTransactions.length) brief.notableTransactions.pop();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.customPerformance.length > 8) brief.customPerformance.pop();
  const refreshTruncation = () => {
    const omitted = {transactions: original.transactions - brief.notableTransactions.length, evolution: original.evolution - brief.evolutionHighlights.length, standings: original.standings - brief.standings.length, custom: original.custom - brief.customPerformance.length, observations: original.observations - brief.observations.length, playoffs: original.playoffs - brief.playoffs.length};
    brief.truncation = {applied: Object.values(omitted).some(Boolean), omitted};
  };
  refreshTruncation();
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.observations.length) { brief.observations.pop(); refreshTruncation(); }
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.customPerformance.length) { brief.customPerformance.pop(); refreshTruncation(); }
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.standings.length > 1) { brief.standings.pop(); refreshTruncation(); }
  while (size() > SEASON_BRIEF_CHARACTER_LIMIT && brief.playoffs.length > 1) { brief.playoffs.shift(); refreshTruncation(); }
}
function estimateTokens(value: string): number { let ascii = 0, nonAscii = 0; for (const character of value) character.charCodeAt(0) < 128 ? ascii += 1 : nonAscii += 1; return Math.ceil(ascii / 3.5 + nonAscii / 1.2); }
function markdown(brief: SeasonBrief): string { return [`# Season ${brief.season} Brief`, "", `- Champion: ${brief.champion.name}`, `- Registry: ${brief.registry.revision ?? "unknown"} (${brief.registry.hash?.slice(0, 12) ?? "unknown"})`, `- Audit fatal/warnings: ${brief.audit.fatal ?? "pending"}/${brief.audit.warnings ?? "pending"}`, `- Battles: ${brief.storage.battles}`, "", "## Standings", "", ...brief.standings.map(entry => `- ${entry.rank}. ${entry.name}: ${entry.points} points, ${entry.series}`), "", "## Custom Performance", "", ...brief.customPerformance.map(entry => `- ${entry.pokemon} (${entry.manager}): ${entry.appearances} appearances, ${entry.kos} KOs, ${entry.kosPerAppearance}/appearance`), "", "## Observations", "", ...(brief.observations.length ? brief.observations.map(value => `- ${value}`) : ["- No technical or statistical flags."]), ""].join("\n"); }
function registryRevision(root: string, hash?: string): string | undefined { if (!hash) return undefined; const manifest = optional<any>(path.join(root, "config-snapshots", hash, "registry-manifest.json")); return manifest?.revision; }
function relative(root: string, file: string): string { return path.relative(root, file).replace(/\\/g, "/"); }
function round(value: number, digits: number): number { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function optional<T>(file: string): T | null { return fs.existsSync(file) ? read<T>(file) : null; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
