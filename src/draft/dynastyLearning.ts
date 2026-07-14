import type {DecisionRecord} from "./decisionLedger";
import {classifyEmergentStyle, clampTrait, type DraftRole, type ManagerDevelopment, type ManagerProfile, type ManagerTraits, type MatchupMemory} from "./managerProfiles";
import {advanceContract, arbitrationSalary, initialContract, payrollResult, type AssetClass, type SportsContract} from "./sportsMarket";
import type {MemberConfigurationEvidence} from "./configurationTelemetry";

export interface DynastyRosterMember {
  assetId?: string;
  scarcity?: "legendary" | "unique-custom" | "elite-ordinary" | "standard";
  tier?: "premium" | "standard";
  economicClass?: "background" | "limited" | "unique";
  debutGeneration?: number;
  configurationSource?: "ai" | "locked-custom";
  configuredSet?: {name?: string; species?: string; item?: string; moves?: string[]; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>};
  configurationEvidence?: MemberConfigurationEvidence;
  family: string;
  pokemon: string;
  method: "auction" | "supplemental" | "keeper" | "free-agent" | "trade" | "waiver" | "registration";
  price: number;
  market: number;
  appearances: number;
  kos: number;
  regularSeasonAppearances: number;
  regularSeasonKos: number;
  roles?: DraftRole[];
  contract?: KeeperContract;
}

export interface DynastyStanding {
  id: string;
  name: string;
  division?: string;
  budget?: number;
  seriesWins: number;
  seriesLosses: number;
  points: number;
  pairWins: number;
  pairLosses: number;
  kos: number;
}

export interface KeeperContract {
  assetId?: string;
  family: string;
  pokemon: string;
  salary: number;
  years: number;
  lastSeasonAppearances: number;
  lastSeasonKos: number;
  yearsRemaining?: number;
  serviceYears?: number;
  guaranteeRate?: number;
  status?: SportsContract["status"];
  originalTeamId?: string;
  acquiredSeason?: number;
  acquisitionCost?: number;
  marketValue?: number;
  assetClass?: AssetClass;
  tagCount?: number;
}

export interface LearningSignal {
  trait: keyof ManagerTraits;
  evidence: number;
  delta: number;
  reason: string;
}

export interface SeasonReview {
  managerId: string;
  performance: number;
  signals: LearningSignal[];
  before: ManagerTraits;
  after: ManagerTraits;
  developmentAfter: ManagerDevelopment;
  emergentStyle: {label: string; confidence: number};
  keepers: KeeperContract[];
  released: Array<{family: string; pokemon: string; reason: string}>;
}

const TRAITS = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const;

export function reviewManagerSeason(
  _base: ManagerProfile,
  current: ManagerProfile,
  standing: DynastyStanding,
  allStandings: DynastyStanding[],
  roster: DynastyRosterMember[],
  decisions: readonly DecisionRecord[],
  previousContracts: KeeperContract[] = [],
  activeRoster: DynastyRosterMember[] = roster,
): SeasonReview {
  const maxPoints = Math.max(1, ...allStandings.map(entry => entry.points));
  const performance = standing.points / maxPoints;
  const totalContribution = Math.max(1, roster.reduce((sum, member) => sum + memberContribution(member), 0));
  const costly = roster.filter(member => member.price >= 20);
  const bargains = roster.filter(member => member.price <= 3);
  const starShare = costly.reduce((sum, member) => sum + memberContribution(member), 0) / totalContribution;
  const starSlots = costly.length / Math.max(1, roster.length);
  const bargainShare = bargains.reduce((sum, member) => sum + memberContribution(member), 0) / totalContribution;
  const bargainSlots = bargains.length / Math.max(1, roster.length);
  const lineupRecords = decisions.filter(record => record.stage === "lineup" && record.actor === current.id);
  const uniqueLineups = new Set(lineupRecords.map(record => JSON.stringify(record.selected))).size;
  const lineupDiversity = lineupRecords.length ? uniqueLineups / lineupRecords.length : .5;
  const leagueSeries = decisions.filter(record => record.stage === "battle" && record.outcome && ((record.context.winner === current.id) || record.context.winner === null));
  const averageTurns = average(leagueSeries.map(record => Number(record.outcome?.turns ?? 0)).filter(value => value > 0));
  const speedEvidence = averageTurns ? clamp01((32 - averageTurns) / 24) : .5;
  const topIds = new Set([...allStandings].filter(entry => entry.id !== current.id).sort((a, b) => b.points - a.points).slice(0, Math.max(1, Math.ceil((allStandings.length - 1) / 2))).map(entry => entry.id));
  const opponentSeries = collectSeriesOutcomes(current.id, decisions);
  const topResults = opponentSeries.filter(result => topIds.has(result.opponent));
  const counterEvidence = topResults.length ? average(topResults.map(result => result.score)) : .5;
  const roleCoverage = average(lineupRecords.map(roleCoverageFromLineupRecord));
  const roleOutcomeSamples = lineupRecords.map(record => ({
    coverage: roleCoverageFromLineupRecord(record),
    outcome: seriesOutcomeFor(current.id, String(record.context.seriesId ?? ""), decisions),
  })).filter(sample => sample.outcome !== null) as Array<{coverage: number; outcome: number}>;
  const synergyEvidence = comparativeEvidence(roleOutcomeSamples);
  const counterfactualLearning = process.env.V4_LEARNING_MODEL === "counterfactual";

  const evidence: Record<keyof ManagerTraits, {value: number; reason: string}> = {
    stars: {value: costly.length ? clamp01(.5 + (starShare - starSlots)) : .35, reason: `高价成员贡献${percent(starShare)}，占名单${percent(starSlots)}`},
    value: {value: bargains.length ? clamp01(.5 + (bargainShare - bargainSlots)) : .35, reason: `低价成员贡献${percent(bargainShare)}，占名单${percent(bargainSlots)}`},
    flexibility: {value: clamp01(lineupDiversity * .65 + performance * .35), reason: `${lineupRecords.length}次选阵产生${uniqueLineups}套不同六人组`},
    synergy: {value: clamp01(performance * .65 + (roleCoverage || .5) * .35), reason: `赛季表现${percent(performance)}，阵容功能覆盖${percent(roleCoverage || .5)}`},
    counter: {value: clamp01(counterEvidence), reason: `面对上半区对手的系列赛成效${percent(counterEvidence)}`},
    risk: {value: clamp01(speedEvidence * .55 + performance * .45), reason: `平均关键胜局回合${averageTurns ? averageTurns.toFixed(1) : "不足"}，结合赛季成效`},
  };

  // V2 learning uses evidence from the decision governed by each trait. Overall
  // standings remain report data and no longer push every personality axis together.
  evidence.flexibility.value = counterfactualLearning ? lineupAlternativeEvidence(current.id, lineupRecords, decisions) : clamp01(lineupDiversity);
  evidence.synergy.value = synergyEvidence;
  evidence.risk.value = clamp01(speedEvidence);

  const after = {...current.traits};
  const developmentAfter: ManagerDevelopment = {
    ...current.development,
    seasons: current.development.seasons + 1,
    exploration: Math.max(.12, .8 * Math.exp(-(current.development.seasons + 1) / 8)),
    strategies: Object.fromEntries(Object.entries(current.development.strategies).map(([trait, posterior]) => [trait, {...posterior}])) as ManagerDevelopment["strategies"],
    styleHistory: current.development.styleHistory.map(entry => ({...entry})),
  };
  const signals: LearningSignal[] = [];
  for (const trait of TRAITS) {
    const prior = current.development.strategies[trait];
    const retainedSamples = Math.max(2, prior.effectiveSamples * .94);
    const effectiveSamples = Math.min(12, retainedSamples + 1);
    const mean = (prior.mean * retainedSamples + evidence[trait].value) / effectiveSamples;
    const confidence = Math.min(1, Math.max(0, (effectiveSamples - 2) / 6));
    developmentAfter.strategies[trait] = {mean, confidence, effectiveSamples};
    after[trait] = clampTrait(.5 + (mean - .5) * confidence * 1.6);
    signals.push({trait, evidence: evidence[trait].value, delta: after[trait] - current.traits[trait], reason: evidence[trait].reason});
  }

  const emergentStyle = classifyEmergentStyle({...current, traits: after, development: developmentAfter});
  developmentAfter.styleHistory.push({season: developmentAfter.seasons, ...emergentStyle});

  const {keepers, released} = selectKeepers(current, activeRoster, previousContracts);
  return {managerId: current.id, performance, signals, before: {...current.traits}, after, developmentAfter, emergentStyle, keepers, released};
}

function lineupAlternativeEvidence(managerId: string, records: DecisionRecord[], decisions: readonly DecisionRecord[]): number {
  const samples = records.map(record => ({
    lineup: JSON.stringify(record.selected),
    outcome: seriesOutcomeFor(managerId, String(record.context.seriesId ?? ""), decisions),
  })).filter(sample => sample.outcome !== null) as Array<{lineup: string; outcome: number}>;
  const byLineup = new Map<string, number[]>();
  for (const sample of samples) byLineup.set(sample.lineup, [...(byLineup.get(sample.lineup) ?? []), sample.outcome]);
  if (byLineup.size < 2) return .5;
  const groups = [...byLineup.entries()].map(([lineup, outcomes]) => ({lineup, uses: outcomes.length, score: average(outcomes)})).sort((a, b) => b.uses - a.uses);
  const baseline = groups[0].score;
  const alternatives = average(groups.slice(1).map(group => group.score));
  return clamp01(.5 + (alternatives - baseline) * .5);
}

export function selectKeepers(
  manager: ManagerProfile,
  roster: DynastyRosterMember[],
  previousContracts: KeeperContract[] = [],
  limit = Number(process.env.V4_MAX_KEEPERS || 3),
): Pick<SeasonReview, "keepers" | "released"> {
  const keeperCap = Number(process.env.V4_KEEPER_CAP || 70);
  const marketArbitration = process.env.V4_CONTRACT_MODEL === "market-arbitration";
  const sportsMarket = process.env.V4_CONTRACT_MODEL === "sports-market";
  const previousByAsset = new Map(previousContracts.filter(contract => contract.assetId).map(contract => [contract.assetId!, contract]));
  const legacyPreviousByFamily = new Map(previousContracts.filter(contract => !contract.assetId).map(contract => [contract.family, contract]));
  const dualLayer = /^(1|true|yes)$/i.test(process.env.V4_DUAL_LAYER || "false");
  const ranked = roster.filter(member => !dualLayer || member.economicClass !== "background").map(member => {
    const old = member.assetId ? previousByAsset.get(member.assetId) : legacyPreviousByFamily.get(member.family);
    const years = (old?.years ?? 0) + 1;
    const baseSalary = old?.salary ?? Math.max(member.price, Math.ceil(member.market * .75));
    const functionalRoles = (member.roles ?? []).filter(role => !["physical", "special"].includes(role)).length;
    const production = member.regularSeasonAppearances ? member.regularSeasonKos / member.regularSeasonAppearances : 0;
    const marketSalary = Math.max(2, Math.ceil(member.market * .85 + Math.min(6, production * 2.5 + functionalRoles * .65)));
    const tenure = Math.min(3, Math.max(0, years - 1));
    const lifecycle = sportsMarket ? nextSportsContract(manager.id, member, old) : undefined;
    const salary = lifecycle?.salary ?? (marketArbitration
      ? Math.max(2, Math.ceil((old?.salary ?? member.price) * .25 + marketSalary * .75 + tenure))
      : Math.max(2, Math.ceil(baseSalary * (years >= 3 ? 1.3 : 1.2))));
    const usage = member.regularSeasonAppearances ? member.regularSeasonKos / member.regularSeasonAppearances : 0;
    const starPreference = manager.traits.stars * Math.min(1, member.price / 30) * 4;
    const valuePenalty = manager.traits.value * salary * .12;
    const continuityGene = manager.genome?.organization?.continuity ?? 0;
    const continuity = (manager.traits.synergy + continuityGene) * Math.min(3, years) * .6;
    const regularSeasonContribution = member.regularSeasonKos * .18 + member.regularSeasonAppearances * .025;
    const scarcePreference = (manager.genome?.organization?.scarceConcentration ?? 0) * (member.economicClass === "unique" || member.economicClass === "limited" ? 2 : 0);
    return {member, years, salary, lifecycle, score: regularSeasonContribution + usage * 4 + starPreference + continuity + scarcePreference - valuePenalty};
  }).sort((a, b) => b.score - a.score || a.salary - b.salary);

  const selected: typeof ranked = [];
  let committed = 0;
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (committed + candidate.salary > keeperCap) continue;
    if (!sportsMarket && candidate.member.appearances === 0 && candidate.member.kos === 0) continue;
    selected.push(candidate);
    committed += candidate.salary;
  }
  const memberIdentity = (member: DynastyRosterMember): string => member.assetId ?? `family:${member.family}`;
  const selectedMembers = new Set(selected.map(entry => memberIdentity(entry.member)));
  return {
    keepers: selected.map(entry => ({assetId: entry.member.assetId, family: entry.member.family, pokemon: entry.member.pokemon, salary: entry.salary, years: entry.years, lastSeasonAppearances: entry.member.appearances, lastSeasonKos: entry.member.kos, ...(entry.lifecycle ?? {})})),
    released: roster.filter(member => !selectedMembers.has(memberIdentity(member))).map(member => ({family: member.family, pokemon: member.pokemon, reason: member.appearances === 0 ? "未进入轮换" : "续约价值低于前三或薪资结构不允许"})),
  };
}

function nextSportsContract(teamId: string, member: DynastyRosterMember, previous: KeeperContract | undefined): SportsContract {
  const assetClass = member.scarcity ?? "standard";
  const inherited = previous ?? member.contract;
  let contract = inherited?.status ? {
    assetId: inherited.assetId ?? member.assetId ?? member.family,
    family: member.family,
    pokemon: member.pokemon,
    salary: inherited.salary,
    yearsRemaining: inherited.yearsRemaining ?? 1,
    serviceYears: inherited.serviceYears ?? inherited.years,
    guaranteeRate: inherited.guaranteeRate ?? .2,
    status: inherited.status,
    originalTeamId: inherited.originalTeamId ?? teamId,
    acquiredSeason: inherited.acquiredSeason ?? 1,
    acquisitionCost: inherited.acquisitionCost ?? member.price,
    marketValue: member.market,
    assetClass: inherited.assetClass ?? assetClass,
    tagCount: inherited.tagCount ?? 0,
  } : initialContract({assetId: member.assetId ?? member.family, family: member.family, pokemon: member.pokemon, teamId, season: Number(process.env.V4_CURRENT_SEASON || 1), marketValue: member.market, acquisitionCost: member.price, assetClass});
  if (inherited) contract = advanceContract(contract);
  if (contract.status === "arbitration") contract = {...contract, salary: arbitrationSalary(contract, Math.max(2, member.market + member.regularSeasonKos / Math.max(1, member.regularSeasonAppearances) * 3)), yearsRemaining: 1};
  return contract;
}

export function updateMatchupMemory(
  previous: MatchupMemory | undefined,
  selectedFamilies: string[],
  result: "win" | "loss" | "draw",
  decay = .85,
): MatchupMemory {
  const familyScores = Object.fromEntries(Object.entries(previous?.familyScores ?? {}).map(([family, score]) => [family, score * decay]));
  const adjustment = result === "win" ? 1 : result === "loss" ? -.5 : 0;
  const credit = selectedFamilies.length ? adjustment / Math.sqrt(selectedFamilies.length) : 0;
  for (const family of selectedFamilies) familyScores[family] = Math.max(-3, Math.min(3, (familyScores[family] ?? 0) + credit));
  return {
    series: (previous?.series ?? 0) + 1,
    wins: (previous?.wins ?? 0) + (result === "win" ? 1 : 0),
    losses: (previous?.losses ?? 0) + (result === "loss" ? 1 : 0),
    familyScores,
  };
}

function collectSeriesOutcomes(managerId: string, decisions: readonly DecisionRecord[]): Array<{opponent: string; score: number}> {
  const games = new Map<string, {opponent: string; wins: number; losses: number}>();
  for (const record of decisions) {
    if (record.stage !== "battle") continue;
    const parsed = seriesParticipants(record);
    if (!parsed || (parsed.left !== managerId && parsed.right !== managerId)) continue;
    const opponent = parsed.left === managerId ? parsed.right : parsed.left;
    const key = `${parsed.left}-${parsed.right}`;
    const current = games.get(key) ?? {opponent, wins: 0, losses: 0};
    const winner = record.context.winner;
    if (winner === managerId) current.wins += 1;
    else if (winner === opponent) current.losses += 1;
    games.set(key, current);
  }
  return [...games.values()].map(result => ({opponent: result.opponent, score: result.wins > result.losses ? 1 : result.wins < result.losses ? 0 : .5}));
}

function roleCoverageFromLineupRecord(record: DecisionRecord): number {
  const roles = Array.isArray(record.context.roles) ? record.context.roles.filter(role => typeof role === "string") : [];
  return roles.length ? Math.min(1, roles.length / 7) : .5;
}

function seriesOutcomeFor(managerId: string, seriesId: string, decisions: readonly DecisionRecord[]): number | null {
  let wins = 0;
  let losses = 0;
  for (const record of decisions) {
    if (record.stage !== "battle" || record.context.seriesId !== seriesId) continue;
    const parsed = seriesParticipants(record);
    if (!parsed) continue;
    const opponent = parsed.left === managerId ? parsed.right : parsed.left;
    if (record.context.winner === managerId) wins += 1;
    else if (record.context.winner === opponent) losses += 1;
  }
  return wins + losses ? wins / (wins + losses) : null;
}

function comparativeEvidence(samples: Array<{coverage: number; outcome: number}>): number {
  if (samples.length < 2) return .5;
  const meanCoverage = average(samples.map(sample => sample.coverage));
  const meanOutcome = average(samples.map(sample => sample.outcome));
  const variance = average(samples.map(sample => (sample.coverage - meanCoverage) ** 2));
  if (variance < 1e-6) return .5;
  const covariance = average(samples.map(sample => (sample.coverage - meanCoverage) * (sample.outcome - meanOutcome)));
  return clamp01(.5 + covariance / Math.sqrt(variance) * 1.5);
}

function seriesParticipants(record: DecisionRecord): {left: string; right: string} | null {
  const left = typeof record.context.left === "string" ? record.context.left : null;
  const right = typeof record.context.right === "string" ? record.context.right : null;
  if (left && right) return {left, right};
  const seriesId = typeof record.context.seriesId === "string" ? record.context.seriesId : record.decision;
  const match = seriesId.match(/^league-([^\s-]+)-([^\s-]+)/);
  return match ? {left: match[1], right: match[2]} : null;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function memberContribution(member: DynastyRosterMember): number {
  const functionalRoles = (member.roles ?? []).filter(role => !["physical", "special"].includes(role)).length;
  return member.regularSeasonKos + member.regularSeasonAppearances * (.12 + Math.min(4, functionalRoles) * .04);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
