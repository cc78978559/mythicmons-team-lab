import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {classifyEmergentStyle, type ManagerProfile, type ManagerTraits} from "./managerProfiles";
import type {LineageIdentity} from "./naturalEvolution";
import {countProgramNodes, strategyProgramHash} from "./strategyProgram";

interface StoredRosterMember {
  assetId?: string;
  family: string;
  pokemon: string;
  scarcity?: string;
  appearances: number;
  kos: number;
  regularSeasonAppearances: number;
  regularSeasonKos: number;
}

interface StoredSeason {
  season: number;
  rank: number;
  points: number;
  champion: boolean;
  roster: StoredRosterMember[];
  review: {
    performance: number;
    emergentStyle: {label: string; confidence: number};
    signals: Array<{trait: keyof ManagerTraits; delta: number; reason: string}>;
  };
}

interface StoredManager {
  id: string;
  name: string;
  baseProfile: ManagerProfile;
  currentProfile: ManagerProfile;
  titles: number;
  totalPoints: number;
  seasons: StoredSeason[];
  lineage: LineageIdentity;
  lineageHistory: LineageIdentity[];
  pendingProfile?: ManagerProfile;
  pendingLineage?: LineageIdentity;
}

interface StoredState {
  version: number;
  seed: string;
  completedSeason: number;
  managers: StoredManager[];
  fingerprint: CareerFingerprint;
  registry?: {hash?: string; revision?: string};
  decisionRecords?: Array<{id: string; stage: string; actor: string; decision: string; selected: unknown; context?: Record<string, unknown>; outcome?: Record<string, unknown>}>;
}

export interface CareerFingerprint {
  codeHash: string;
  dataHash: string;
  registryHash: string;
  benchmarkHash: string;
  dependencyHash: string;
  pokemonShowdownVersion: string;
}

export interface ManagerCareerPortrait {
  schemaVersion: 1;
  id: string;
  name: string;
  record: {seasons: number; titles: number; totalPoints: number; averageRank: number; bestSeason: number; bestRank: number; worstSeason: number; worstRank: number};
  seasonArc: Array<{season: number; rank: number; points: number; champion: boolean; style: string; performance: number}>;
  identity: {
    style: {label: string; confidence: number};
    strongestTraits: Array<{trait: keyof ManagerTraits; value: number; change: number}>;
    economics: ManagerProfile["economics"];
    tactics: ManagerProfile["tactics"];
    exploration: number;
    strategyProgram: {hash: string; nodes: number};
    lineage: LineageIdentity;
    lineageDepth: number;
  };
  signatureAssets: Array<{pokemon: string; family: string; scarcity: string; seasons: number[]; appearances: number; kos: number}>;
  turningPoints: Array<{season: number; trait: keyof ManagerTraits; delta: number; reason: string}>;
  rivalries: Array<{opponentId: string; series: number; wins: number; losses: number; score: number}>;
  decisionSummary: {total: number; stages: Record<string, number>; recent: Array<{id: string; stage: string; decision: string; selected: unknown}>};
  introduction: string;
  evidence: string[];
}

export interface CareerMemoryCheckpoint {
  schemaVersion: 1;
  source: {seed: string; completedSeason: number; stateVersion: number; fingerprint: CareerFingerprint; registry?: {hash?: string; revision?: string}};
  managers: Array<{
    id: string;
    name: string;
    baseProfile: ManagerProfile;
    currentProfile: ManagerProfile;
    lineage: LineageIdentity;
    lineageHistory: LineageIdentity[];
    pendingProfile?: ManagerProfile;
    pendingLineage?: LineageIdentity;
  }>;
}

export interface CareerArchiveResult {
  root: string;
  destination: string;
  managers: number;
  portraits: string[];
  checkpointManifest: string;
  checkpointBytes: number;
  compressedBytes: number;
}

export function buildCareerArchive(rootDirectory: string, destination = path.join(rootDirectory, "career-portraits")): CareerArchiveResult {
  const root = path.resolve(rootDirectory), target = path.resolve(destination);
  const state = readJson<StoredState>(path.join(root, "dynasty-state.json"));
  fs.mkdirSync(path.join(target, "managers"), {recursive: true});
  const portraits = state.managers.map(manager => buildPortrait(manager, state));
  for (const portrait of portraits) {
    writeJson(path.join(target, "managers", `${portrait.id}.json`), portrait);
    fs.writeFileSync(path.join(target, "managers", `${portrait.id}.md`), portraitMarkdown(portrait), "utf8");
  }
  writeJson(path.join(target, "index.json"), {
    schemaVersion: 1,
    source: {seed: state.seed, completedSeason: state.completedSeason},
    managers: portraits.map(portrait => ({id: portrait.id, name: portrait.name, titles: portrait.record.titles, totalPoints: portrait.record.totalPoints, style: portrait.identity.style, summary: portrait.introduction.split("\n")[0]})),
  });
  fs.writeFileSync(path.join(target, "index.md"), portraitIndexMarkdown(portraits, state.completedSeason), "utf8");
  const checkpoint = exportCareerMemoryCheckpoint(state, target);
  writeJson(path.join(target, "token-budget.json"), {
    schemaVersion: 1,
    defaultIndex: "index.json",
    defaultManagerPattern: "managers/manager-XX.json",
    excludedByDefault: ["../dynasty-state.json", "../season-*/decision-ledger.json", "../season-*/battles"],
    estimatedIndexTokens: estimateTokens(fs.readFileSync(path.join(target, "index.json"), "utf8")),
    maximumManagerTokens: Math.max(...portraits.map(portrait => estimateTokens(JSON.stringify(portrait)))),
  });
  return {root, destination: target, managers: portraits.length, portraits: portraits.map(portrait => path.join(target, "managers", `${portrait.id}.json`)), ...checkpoint};
}

export function loadCareerMemoryCheckpoint(manifestOrArchive: string): CareerMemoryCheckpoint {
  const input = path.resolve(manifestOrArchive);
  let archive = input, expectedHash: string | undefined;
  if (!input.endsWith(".gz")) {
    const manifest = readJson<{archive: string; sha256: string}>(input);
    archive = path.resolve(path.dirname(input), manifest.archive);
    expectedHash = manifest.sha256;
  }
  const compressed = fs.readFileSync(archive), source = zlib.gunzipSync(compressed);
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  if (expectedHash && hash !== expectedHash) throw new Error(`Career checkpoint hash mismatch: ${hash} != ${expectedHash}`);
  const checkpoint = JSON.parse(source.toString("utf8")) as CareerMemoryCheckpoint;
  if (checkpoint.schemaVersion !== 1 || !Array.isArray(checkpoint.managers) || !checkpoint.managers.length) throw new Error("Invalid career memory checkpoint");
  return checkpoint;
}

export function readCareerPortrait(directory: string, managerId: string): ManagerCareerPortrait {
  const id = /^manager-\d{2}$/.test(managerId) ? managerId : `manager-${String(Number(managerId)).padStart(2, "0")}`;
  return readJson<ManagerCareerPortrait>(path.join(path.resolve(directory), "managers", `${id}.json`));
}

export function compactPortrait(portrait: ManagerCareerPortrait): Record<string, unknown> {
  return {
    id: portrait.id,
    name: portrait.name,
    record: portrait.record,
    style: portrait.identity.style,
    strongestTraits: portrait.identity.strongestTraits,
    signatureAssets: portrait.signatureAssets.slice(0, 4),
    turningPoints: portrait.turningPoints.slice(0, 4),
    rivalries: portrait.rivalries.slice(0, 3),
    introduction: portrait.introduction,
  };
}

function buildPortrait(manager: StoredManager, state: StoredState): ManagerCareerPortrait {
  const seasons = [...manager.seasons].sort((a, b) => a.season - b.season);
  const ranked = [...seasons].sort((a, b) => a.rank - b.rank || b.points - a.points);
  const worstRanked = [...seasons].sort((a, b) => b.rank - a.rank || a.points - b.points);
  const currentStyle = classifyEmergentStyle(manager.currentProfile);
  const strongestTraits = (Object.keys(manager.currentProfile.traits) as Array<keyof ManagerTraits>).map(trait => ({trait, value: manager.currentProfile.traits[trait], change: manager.currentProfile.traits[trait] - manager.baseProfile.traits[trait]})).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.value - a.value).slice(0, 4);
  const signatureAssets = aggregateAssets(seasons);
  const turningPoints = seasons.flatMap(season => season.review.signals.map(signal => ({season: season.season, trait: signal.trait, delta: signal.delta, reason: signal.reason}))).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  const rivalries = Object.entries(manager.currentProfile.matchupMemory ?? {}).map(([opponentId, memory]) => ({opponentId, series: memory.series, wins: memory.wins, losses: memory.losses, score: (memory.wins - memory.losses) / Math.max(1, memory.series)})).sort((a, b) => b.series - a.series || Math.abs(b.score) - Math.abs(a.score)).slice(0, 6);
  const decisions = (state.decisionRecords ?? []).filter(record => record.actor === manager.id);
  const stages: Record<string, number> = {};
  decisions.forEach(record => stages[record.stage] = (stages[record.stage] ?? 0) + 1);
  const record = {
    seasons: seasons.length,
    titles: manager.titles,
    totalPoints: manager.totalPoints,
    averageRank: round(seasons.reduce((sum, season) => sum + season.rank, 0) / Math.max(1, seasons.length)),
    bestSeason: ranked[0]?.season ?? 0,
    bestRank: ranked[0]?.rank ?? 0,
    worstSeason: worstRanked[0]?.season ?? 0,
    worstRank: worstRanked[0]?.rank ?? 0,
  };
  const portrait: Omit<ManagerCareerPortrait, "introduction"> = {
    schemaVersion: 1,
    id: manager.id,
    name: manager.name,
    record,
    seasonArc: seasons.map(season => ({season: season.season, rank: season.rank, points: season.points, champion: season.champion, style: season.review.emergentStyle.label, performance: round(season.review.performance)})),
    identity: {
      style: currentStyle,
      strongestTraits,
      economics: manager.currentProfile.economics,
      tactics: manager.currentProfile.tactics,
      exploration: manager.currentProfile.development.exploration,
      strategyProgram: {hash: strategyProgramHash(manager.currentProfile.strategyProgram!), nodes: countProgramNodes(manager.currentProfile.strategyProgram!)},
      lineage: manager.lineage,
      lineageDepth: manager.lineageHistory.length,
    },
    signatureAssets,
    turningPoints,
    rivalries,
    decisionSummary: {total: decisions.length, stages, recent: decisions.slice(-8).map(record => ({id: record.id, stage: record.stage, decision: record.decision, selected: record.selected}))},
    evidence: ["dynasty-state.json", ...seasons.map(season => `season-${String(season.season).padStart(2, "0")}`)],
  };
  return {...portrait, introduction: introductionFor(portrait)};
}

function introductionFor(portrait: Omit<ManagerCareerPortrait, "introduction">): string {
  const best = portrait.seasonArc.find(season => season.season === portrait.record.bestSeason);
  const worst = portrait.seasonArc.find(season => season.season === portrait.record.worstSeason);
  const trait = portrait.identity.strongestTraits[0];
  const asset = portrait.signatureAssets[0];
  const turn = portrait.turningPoints[0];
  const rival = portrait.rivalries[0];
  const titleLine = portrait.record.titles ? `我在这段旅程里拿到${portrait.record.titles}次冠军，累计${portrait.record.totalPoints}分。` : `我没有拿到冠军，但九季累计${portrait.record.totalPoints}分，这些失败同样塑造了我。`;
  const arc = best && worst ? `我的高点是第${best.season}季第${best.rank}名，最艰难的是第${worst.season}季第${worst.rank}名。` : "我的赛季轨迹仍在形成。";
  const traitLine = trait ? `我从同一个新手起点出发，变化最明显的是${traitLabel(trait.trait)}：从${round(trait.value - trait.change, 3)}走到${round(trait.value, 3)}。` : "我仍接近最初的均衡状态。";
  const assetLine = asset ? `${asset.pokemon}是最能代表我选择的伙伴之一，跨${asset.seasons.length}季出场${asset.appearances}次、取得${asset.kos}次击倒。` : "我还没有形成稳定的代表阵容。";
  const lesson = turn ? `真正改变我的一次证据出现在第${turn.season}季：${turn.reason}。我没有把它当成标签，而是把${traitLabel(turn.trait)}调整了${signed(turn.delta)}。` : "我不会在证据不足时强行改变自己。";
  const rivalry = rival ? `我也记得与${rival.opponentId}的长期交锋：${rival.series}个系列赛，${rival.wins}胜${rival.losses}负。` : "我的对手档案仍需要更多样本。";
  return [`我是${portrait.name}。${titleLine}`, arc, traitLine, `如今我的主要风格被描述为“${portrait.identity.style.label}”，但这只是结果的概括，不是预设身份。`, assetLine, lesson, rivalry, "进入下一段旅程时，我会保留这些后验、对手记忆和策略程序；积分、阵容与资产则重新归零，让经验而不是旧优势接受检验。"].join("\n");
}

function aggregateAssets(seasons: StoredSeason[]): ManagerCareerPortrait["signatureAssets"] {
  const assets = new Map<string, ManagerCareerPortrait["signatureAssets"][number] & {seasonSet: Set<number>}>();
  for (const season of seasons) for (const member of season.roster) {
    const key = member.assetId ?? member.family;
    const entry = assets.get(key) ?? {pokemon: member.pokemon, family: member.family, scarcity: member.scarcity ?? "standard", seasons: [], seasonSet: new Set<number>(), appearances: 0, kos: 0};
    entry.seasonSet.add(season.season);
    entry.appearances += member.regularSeasonAppearances ?? member.appearances ?? 0;
    entry.kos += member.regularSeasonKos ?? member.kos ?? 0;
    assets.set(key, entry);
  }
  return [...assets.values()].map(({seasonSet, ...entry}) => ({...entry, seasons: [...seasonSet].sort((a, b) => a - b)})).sort((a, b) => b.kos - a.kos || b.appearances - a.appearances).slice(0, 8);
}

function exportCareerMemoryCheckpoint(state: StoredState, destination: string): Pick<CareerArchiveResult, "checkpointManifest" | "checkpointBytes" | "compressedBytes"> {
  const checkpoint: CareerMemoryCheckpoint = {
    schemaVersion: 1,
    source: {seed: state.seed, completedSeason: state.completedSeason, stateVersion: state.version, fingerprint: state.fingerprint, registry: state.registry},
    managers: state.managers.map(manager => ({id: manager.id, name: manager.name, baseProfile: manager.baseProfile, currentProfile: manager.currentProfile, lineage: manager.lineage, lineageHistory: manager.lineageHistory, pendingProfile: manager.pendingProfile, pendingLineage: manager.pendingLineage})),
  };
  const source = Buffer.from(`${JSON.stringify(checkpoint)}\n`, "utf8"), compressed = zlib.gzipSync(source, {level: 9});
  const archive = path.join(destination, "career-memory.json.gz"), manifestPath = path.join(destination, "career-memory.json");
  fs.writeFileSync(archive, compressed);
  writeJson(manifestPath, {
    schemaVersion: 1,
    archive: path.basename(archive),
    sha256: crypto.createHash("sha256").update(source).digest("hex"),
    sourceBytes: source.length,
    compressedBytes: compressed.length,
    managers: checkpoint.managers.length,
    completedSeason: state.completedSeason,
    carries: ["baseProfile", "currentProfile", "lineage", "lineageHistory", "pendingProfile", "pendingLineage"],
    resets: ["season", "titles", "points", "cash", "contracts", "assets", "market"],
  });
  return {checkpointManifest: manifestPath, checkpointBytes: source.length, compressedBytes: compressed.length};
}

function portraitMarkdown(portrait: ManagerCareerPortrait): string {
  const lines = [`# ${portrait.name}`, "", ...portrait.introduction.split("\n").map(line => `${line}  `), "", "## 九季轨迹", "", "| 赛季 | 排名 | 积分 | 冠军 | 风格后验 |", "|---:|---:|---:|---|---|"];
  for (const season of portrait.seasonArc) lines.push(`| ${season.season} | ${season.rank} | ${season.points} | ${season.champion ? "是" : "否"} | ${season.style} |`);
  lines.push("", "## 代表伙伴", "", ...portrait.signatureAssets.slice(0, 6).map(asset => `- ${asset.pokemon}：第${asset.seasons.join("、")}季，${asset.appearances}次出场，${asset.kos}次击倒。`), "", "## 证据", "", ...portrait.evidence.map(evidence => `- ${evidence}`), "");
  return lines.join("\n");
}

function portraitIndexMarkdown(portraits: ManagerCareerPortrait[], seasons: number): string {
  const lines = ["# 经理生涯自述索引", "", `本地生成，共${portraits.length}位经理、${seasons}个赛季。完整自述位于 \`managers/manager-XX.md\`。`, "", "| 经理 | 冠军 | 积分 | 当前风格 | 一句话自述 |", "|---|---:|---:|---|---|"];
  for (const portrait of [...portraits].sort((a, b) => b.record.titles - a.record.titles || b.record.totalPoints - a.record.totalPoints)) lines.push(`| ${portrait.name} | ${portrait.record.titles} | ${portrait.record.totalPoints} | ${portrait.identity.style.label} | ${portrait.introduction.split("\n")[0]} |`);
  return `${lines.join("\n")}\n`;
}

function traitLabel(trait: keyof ManagerTraits): string {
  return ({risk: "冒险", stars: "明星偏好", synergy: "协同", counter: "针对", value: "价值", flexibility: "灵活"} as const)[trait];
}
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${round(value, 3)}`; }
function round(value: number, digits = 2): number { return Number((Number.isFinite(value) ? value : 0).toFixed(digits)); }
function estimateTokens(text: string): number { return Math.ceil(text.length / 3.2); }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
