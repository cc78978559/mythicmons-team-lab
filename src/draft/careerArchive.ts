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
  schemaVersion: 2;
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
  interview: {
    headline: string;
    opening: string;
    agenda: Array<{id: string; prompt: string; answer: string; evidence: string[]}>;
    closing: string;
  };
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

interface NarrativeQualityReport {
  schemaVersion: 1;
  managers: number;
  uniqueHeadlines: number;
  uniqueOpenings: number;
  uniqueIntroductions: number;
  uniqueAgendaSignatures: number;
  agendaSections: {minimum: number; maximum: number; average: number};
  introductionCharacters: {minimum: number; maximum: number; average: number};
  sectionsWithoutEvidence: number;
  duplicateIntroductionGroups: string[][];
  passed: boolean;
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
    schemaVersion: 2,
    source: {seed: state.seed, completedSeason: state.completedSeason},
    managers: portraits.map(portrait => ({id: portrait.id, name: portrait.name, titles: portrait.record.titles, totalPoints: portrait.record.totalPoints, style: portrait.identity.style, headline: portrait.interview.headline, summary: portrait.interview.opening})),
  });
  fs.writeFileSync(path.join(target, "index.md"), portraitIndexMarkdown(portraits, state.completedSeason), "utf8");
  const narrativeQuality = assessNarrativeQuality(portraits);
  writeJson(path.join(target, "narrative-quality.json"), narrativeQuality);
  if (!narrativeQuality.passed) throw new Error(`Career interview quality audit failed; inspect ${path.join(target, "narrative-quality.json")}`);
  const checkpoint = exportCareerMemoryCheckpoint(state, target);
  writeJson(path.join(target, "token-budget.json"), {
    schemaVersion: 2,
    defaultIndex: "index.json",
    defaultManagerPattern: "managers/manager-XX.json",
    excludedByDefault: ["../dynasty-state.json", "../season-*/decision-ledger.json", "../season-*/battles"],
    estimatedIndexTokens: estimateTokens(fs.readFileSync(path.join(target, "index.json"), "utf8")),
    maximumDefaultManagerTokens: Math.max(...portraits.map(portrait => estimateTokens(JSON.stringify(compactPortrait(portrait))))),
    maximumManagerTokens: Math.max(...portraits.map(portrait => estimateTokens(JSON.stringify(portrait)))),
  });
  return {root, destination: target, managers: portraits.length, portraits: portraits.map(portrait => path.join(target, "managers", `${portrait.id}.json`)), ...checkpoint};
}

function assessNarrativeQuality(portraits: ManagerCareerPortrait[]): NarrativeQualityReport {
  const duplicateGroups = groupsBy(portraits, portrait => portrait.introduction).filter(group => group.length > 1).map(group => group.map(portrait => portrait.id));
  const sectionCounts = portraits.map(portrait => portrait.interview.agenda.length);
  const characterCounts = portraits.map(portrait => portrait.introduction.length);
  const sectionsWithoutEvidence = portraits.flatMap(portrait => portrait.interview.agenda).filter(section => section.evidence.length === 0).length;
  const unique = <T>(values: T[]): number => new Set(values).size;
  const average = (values: number[]): number => round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  return {
    schemaVersion: 1,
    managers: portraits.length,
    uniqueHeadlines: unique(portraits.map(portrait => portrait.interview.headline)),
    uniqueOpenings: unique(portraits.map(portrait => portrait.interview.opening)),
    uniqueIntroductions: unique(portraits.map(portrait => portrait.introduction)),
    uniqueAgendaSignatures: unique(portraits.map(portrait => portrait.interview.agenda.map(section => section.id).join(","))),
    agendaSections: {minimum: Math.min(...sectionCounts), maximum: Math.max(...sectionCounts), average: average(sectionCounts)},
    introductionCharacters: {minimum: Math.min(...characterCounts), maximum: Math.max(...characterCounts), average: average(characterCounts)},
    sectionsWithoutEvidence,
    duplicateIntroductionGroups: duplicateGroups,
    passed: duplicateGroups.length === 0 && sectionsWithoutEvidence === 0 && Math.min(...sectionCounts) >= 4,
  };
}

function groupsBy<T>(values: T[], keyFor: (value: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return [...groups.values()];
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
    interview: portrait.interview,
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
  const rivalries = selectRivalries(Object.entries(manager.currentProfile.matchupMemory ?? {}).map(([opponentId, memory]) => ({opponentId, series: memory.series, wins: memory.wins, losses: memory.losses, score: (memory.wins - memory.losses) / Math.max(1, memory.series)})));
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
  const portrait: Omit<ManagerCareerPortrait, "introduction" | "interview"> = {
    schemaVersion: 2,
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
  const interview = interviewFor(portrait);
  return {...portrait, interview, introduction: [interview.opening, ...interview.agenda.map(section => section.answer), interview.closing].join("\n\n")};
}

function interviewFor(portrait: Omit<ManagerCareerPortrait, "introduction" | "interview">): ManagerCareerPortrait["interview"] {
  const best = portrait.seasonArc.find(season => season.season === portrait.record.bestSeason);
  const worst = portrait.seasonArc.find(season => season.season === portrait.record.worstSeason);
  const last = portrait.seasonArc.at(-1);
  const trait = portrait.identity.strongestTraits[0];
  const asset = portrait.signatureAssets[0];
  const turn = portrait.turningPoints[0];
  const championSeasons = portrait.seasonArc.filter(season => season.champion).map(season => season.season);
  const strongestRival = [...portrait.rivalries].sort((a, b) => b.score - a.score || b.series - a.series)[0];
  const hardestRival = [...portrait.rivalries].sort((a, b) => a.score - b.score || b.series - a.series)[0];
  const belief = trait ? beliefForTrait(trait.trait, trait.change) : "我仍在寻找足以反复验证的比赛原则";
  const opening = `${voiceOpening(portrait)}我是${portrait.name}。${portrait.record.titles ? `我带着${portrait.record.titles}座冠军结束这九季` : "九季过去，我还没有赢得冠军"}，但如果只用奖杯介绍我，就会漏掉最重要的部分：${belief}。`;
  const candidates: Array<{id: string; priority: number; prompt: string; answer: string; evidence: string[]}> = [];

  if (trait) candidates.push({
    id: "belief", priority: 90 + Math.abs(trait.change) * 300,
    prompt: "九季以后，你究竟相信怎样的比赛？",
    answer: `联盟把我概括为“${portrait.identity.style.label}”，我接受这个描述，但不把它当身份。起点时我的${traitLabel(trait.trait)}是${round(trait.value - trait.change, 3)}，现在是${round(trait.value, 3)}。${beliefSentence(trait.trait, trait.change)}这是九季结果留下的后验，不是我在第一天替自己写好的性格。`,
    evidence: ["dynasty-state.json:baseProfile", "dynasty-state.json:currentProfile"],
  });
  if (portrait.record.titles && best) candidates.push({
    id: "championship", priority: 105 + portrait.record.titles * 15,
    prompt: portrait.record.titles > 1 ? "两次夺冠证明了同一件事吗？" : "那次冠军改变了你什么？",
    answer: `我的冠军来自第${championSeasons.join("、")}季。${best.season === championSeasons[0] ? `第${best.season}季也是我的最高排名` : `其中第${best.season}季是我排名最高的一年`}。我不会把冠军解释成所有选择都正确；它真正强化的是${belief}。后来成绩再次下滑，也说明一条成功路线不会自动适用于下一张名单。`,
    evidence: championSeasons.map(season => `season-${String(season).padStart(2, "0")}:champion`),
  });
  if (turn) candidates.push({
    id: "turning-point", priority: 85 + Math.abs(turn.delta) * 400,
    prompt: `你是什么时候开始改变原来的判断？`,
    answer: `第${turn.season}季留下的证据最难忽略：${turn.reason}。那一季之后，我把${traitLabel(turn.trait)}调整了${signed(turn.delta)}。数字本身不是故事，真正重要的是它迫使我承认，原来的判断无法完整解释比赛。`,
    evidence: [`season-${String(turn.season).padStart(2, "0")}:review.signals.${turn.trait}`],
  });
  if (asset) candidates.push({
    id: "signature", priority: 70 + Math.min(35, asset.kos / 8),
    prompt: `哪位伙伴最能说明你的选择？`,
    answer: `${asset.pokemon}最接近我的答案。它在第${asset.seasons.join("、")}季进入我的名单，累计${asset.appearances}次常规赛出场、${asset.kos}次击倒。重要的不只是产量，而是我一次次愿意围绕它安排资源和阵容；这比任何风格标签更诚实。`,
    evidence: asset.seasons.map(season => `season-${String(season).padStart(2, "0")}:roster:${asset.family}`),
  });
  if (worst) {
    const failureSignal = portrait.turningPoints.filter(point => point.season === worst.season).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    candidates.push({
      id: "failure", priority: 80 + worst.rank * 1.5 + (last?.season === worst.season ? 20 : 0),
      prompt: last?.season === worst.season ? "为什么最后一季反而成了最低点？" : "你最不愿回避的是哪个赛季？",
      answer: `第${worst.season}季，我只排在第${worst.rank}。${failureSignal ? `那次复盘指向了“${failureSignal.reason}”，并推动${traitLabel(failureSignal.trait)}变化${signed(failureSignal.delta)}。` : "档案没有给我一个可以轻易归咎的单一原因。"}${portrait.record.titles ? "有冠军经历以后，这种失败更不能用经验不足搪塞。" : "没有冠军作掩护，我只能把它当成路线仍未完成的证据。"}`,
      evidence: [`season-${String(worst.season).padStart(2, "0")}:standing`, `season-${String(worst.season).padStart(2, "0")}:review`],
    });
  }
  if (strongestRival && hardestRival) candidates.push({
    id: "rivalry", priority: 75 + Math.max(strongestRival.series, hardestRival.series),
    prompt: strongestRival.opponentId === hardestRival.opponentId ? "哪位对手最了解你？" : "哪些对手定义了你的边界？",
    answer: strongestRival.opponentId === hardestRival.opponentId
      ? `我和${managerName(strongestRival.opponentId)}打了${strongestRival.series}个系列赛，${strongestRival.wins}胜${strongestRival.losses}负。样本足够长，它已经不只是一个对手，而是检验我是否真的进步的标尺。`
      : `面对${managerName(strongestRival.opponentId)}，我在${strongestRival.series}个系列赛里取得${strongestRival.wins}胜${strongestRival.losses}负；而${managerName(hardestRival.opponentId)}让我付出的代价更大，${hardestRival.series}次交锋只有${hardestRival.wins}胜。一个让我看见上限，一个提醒我盲区在哪里。`,
    evidence: [`dynasty-state.json:matchupMemory.${strongestRival.opponentId}`, `dynasty-state.json:matchupMemory.${hardestRival.opponentId}`],
  });
  const agenda = candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 5).map(({priority: _priority, ...section}) => section);
  const unresolved = unresolvedQuestion(portrait, last, trait);
  return {
    headline: headlineFor(portrait, last, trait),
    opening,
    agenda,
    closing: `下一段旅程会清空我的积分、阵容和资产，却不会替我抹掉判断。我要重新回答的问题是：${unresolved}这一次，旧经验不会被当成荣誉继承，只会被当成需要再次验证的假设。`,
  };
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

function selectRivalries(all: ManagerCareerPortrait["rivalries"]): ManagerCareerPortrait["rivalries"] {
  if (!all.length) return [];
  const meaningful = all.filter(entry => entry.series >= 3);
  const pool = meaningful.length ? meaningful : all;
  const selected: ManagerCareerPortrait["rivalries"] = [];
  const add = (entry: ManagerCareerPortrait["rivalries"][number] | undefined) => { if (entry && !selected.some(value => value.opponentId === entry.opponentId)) selected.push(entry); };
  add([...pool].sort((a, b) => b.series - a.series || Math.abs(b.score) - Math.abs(a.score))[0]);
  add([...pool].sort((a, b) => b.score - a.score || b.series - a.series)[0]);
  add([...pool].sort((a, b) => a.score - b.score || b.series - a.series)[0]);
  for (const entry of [...pool].sort((a, b) => b.series - a.series || Math.abs(b.score) - Math.abs(a.score))) {
    add(entry);
    if (selected.length >= 6) break;
  }
  return selected;
}

function voiceOpening(portrait: Omit<ManagerCareerPortrait, "introduction" | "interview">): string {
  const strongest = portrait.identity.strongestTraits[0];
  if (!strongest) return "我先从结果说起。";
  if (strongest.trait === "risk") return strongest.change >= 0 ? "我不习惯把谨慎说成成熟。" : "我先谈边界，再谈野心。";
  if (strongest.trait === "stars") return strongest.change >= 0 ? "我不回避自己越来越依赖顶级核心。" : "我不相信名字本身能够赢球。";
  if (strongest.trait === "value") return strongest.change >= 0 ? "我最在意的从来不是价格，而是价格遗漏了什么。" : "我曾经把低价当成聪明，后来不再如此。";
  if (strongest.trait === "counter") return strongest.change >= 0 ? "谈我之前，最好先谈我面对过谁。" : "我花了很久才承认，过度盯着对手也会丢掉自己。";
  if (strongest.trait === "synergy") return strongest.change >= 0 ? "我评价一名成员时，总会先看他让身边的人变成什么。" : "有时完整的体系，也会掩盖缺少决定性力量的事实。";
  return strongest.change >= 0 ? "九季里，我最依赖的是重新组织答案的能力。" : "变化并不总意味着进步，我对此保持警惕。";
}

function beliefForTrait(trait: keyof ManagerTraits, change: number): string {
  const positive = change >= 0;
  const beliefs: Record<keyof ManagerTraits, [string, string]> = {
    risk: ["有些上限只能在承担风险后出现", "长期竞争首先要求控制失败的代价"],
    stars: ["关键比赛需要少数能够接管局面的核心", "名气不能替代完整而可靠的阵容"],
    synergy: ["成员之间的联结比孤立强度更接近胜利", "体系不能成为回避个体质量的借口"],
    counter: ["理解具体对手比坚持抽象正确更重要", "球队必须先拥有自己的答案，再谈针对别人"],
    value: ["被市场忽略的贡献能够支撑长期竞争", "低价本身不是价值，兑现才是"],
    flexibility: ["持续重组比守住单一路线更可靠", "频繁变化也可能只是没有形成判断"],
  };
  return beliefs[trait][positive ? 0 : 1];
}

function beliefSentence(trait: keyof ManagerTraits, change: number): string {
  const direction = change >= 0 ? "越来越愿意" : "越来越不愿意";
  const actions: Record<keyof ManagerTraits, string> = {
    risk: "用波动换取更高上限",
    stars: "把资源交给少数顶级核心",
    synergy: "为了整体关系牺牲纸面强度",
    counter: "围绕具体对手重写方案",
    value: "相信低成本成员能够持续兑现",
    flexibility: "在赛季中反复改变组织方式",
  };
  return `我${direction}${actions[trait]}。`;
}

function headlineFor(portrait: Omit<ManagerCareerPortrait, "introduction" | "interview">, last: ManagerCareerPortrait["seasonArc"][number] | undefined, trait: ManagerCareerPortrait["identity"]["strongestTraits"][number] | undefined): string {
  const belief = trait ? beliefForTrait(trait.trait, trait.change) : "经验仍需重新证明";
  if (portrait.record.titles > 1 && last?.rank === portrait.record.worstRank) return `${portrait.record.titles}冠之后跌至第${last.rank}名：${belief}`;
  if (portrait.record.titles) return `${portrait.record.titles}冠不是结论：${belief}`;
  if (portrait.record.bestRank <= 3) return `最接近冠军之后：${belief}`;
  return `没有冠军作掩护：${belief}`;
}

function unresolvedQuestion(portrait: Omit<ManagerCareerPortrait, "introduction" | "interview">, last: ManagerCareerPortrait["seasonArc"][number] | undefined, trait: ManagerCareerPortrait["identity"]["strongestTraits"][number] | undefined): string {
  if (last?.rank === portrait.record.worstRank && portrait.record.titles) return "我能否保留冠军路线的上限，同时不再让一次错误的核心判断拖垮整季？";
  if (!portrait.record.titles && portrait.record.bestRank <= 3) return "我能否把接近冠军的一个赛季，变成可以重复的胜利方法？";
  if (!portrait.record.titles) return "我的经验究竟已经形成竞争优势，还是只让我更擅长解释失败？";
  if (trait?.trait === "stars" && trait.change > 0) return "当最好的核心不在手里时，我是否仍能建立冠军级阵容？";
  if (trait?.trait === "value" && trait.change > 0) return "我能否继续发现价值，而不把节省资源误当成胜利本身？";
  return "我能否证明已经形成的风格可以跨越不同名单，而不是只属于过去的冠军赛季？";
}

function managerName(id: string): string {
  const match = id.match(/^manager-(\d{2})$/);
  return match ? `经理 ${match[1]}` : id;
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
  const lines = [`# ${portrait.name}`, "", `> ${portrait.interview.headline}`, "", portrait.interview.opening, "", "## 生涯专访", ""];
  for (const section of portrait.interview.agenda) lines.push(`### ${section.prompt}`, "", section.answer, "", `证据：${section.evidence.join("；")}`, "");
  lines.push("## 下一段旅程", "", portrait.interview.closing, "", "## 九季轨迹", "", "| 赛季 | 排名 | 积分 | 冠军 | 风格后验 |", "|---:|---:|---:|---|---|");
  for (const season of portrait.seasonArc) lines.push(`| ${season.season} | ${season.rank} | ${season.points} | ${season.champion ? "是" : "否"} | ${season.style} |`);
  lines.push("", "## 代表伙伴", "", ...portrait.signatureAssets.slice(0, 6).map(asset => `- ${asset.pokemon}：第${asset.seasons.join("、")}季，${asset.appearances}次出场，${asset.kos}次击倒。`), "", "## 证据", "", ...portrait.evidence.map(evidence => `- ${evidence}`), "");
  return lines.join("\n");
}

function portraitIndexMarkdown(portraits: ManagerCareerPortrait[], seasons: number): string {
  const lines = ["# 经理生涯自述索引", "", `本地生成，共${portraits.length}位经理、${seasons}个赛季。完整专访位于 \`managers/manager-XX.md\`。`, "", "| 经理 | 冠军 | 积分 | 当前风格 | 自述主题 |", "|---|---:|---:|---|---|"];
  for (const portrait of [...portraits].sort((a, b) => b.record.titles - a.record.titles || b.record.totalPoints - a.record.totalPoints)) lines.push(`| ${portrait.name} | ${portrait.record.titles} | ${portrait.record.totalPoints} | ${portrait.identity.style.label} | ${portrait.interview.headline} |`);
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
