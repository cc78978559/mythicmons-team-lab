export interface BossDefinition {
  id: string;
  name: string;
  availableFromGeneration: number;
  rewardPoints: number;
  memberIds: string[];
}

export interface BossState {
  bossId: string;
  active: boolean;
  defeatedSeason: number | null;
  defeatedBy: string | null;
}

export interface BossQualifierEntrant {
  id: string;
  seed: number;
}

export interface BossVolunteer extends BossQualifierEntrant {
  preference: number;
}

export const RED_BOSS: BossDefinition = {
  id: "g1-red",
  name: "Red",
  availableFromGeneration: 1,
  rewardPoints: 3,
  memberIds: ["boss-red-pikachu", "boss-red-charizard", "boss-red-venusaur", "boss-red-blastoise", "boss-red-lapras", "boss-red-snorlax"],
};

export function initialBossState(definition: BossDefinition): BossState {
  return {bossId: definition.id, active: true, defeatedSeason: null, defeatedBy: null};
}

export function bossCanBeChallenged(definition: BossDefinition, state: BossState, generation: number): boolean {
  return state.bossId === definition.id && state.active && state.defeatedSeason === null && generation >= definition.availableFromGeneration;
}

export function recordBossChallenge(definition: BossDefinition, state: BossState, season: number, challengerId: string, defeated: boolean): {state: BossState; points: number} {
  if (!state.active || state.defeatedSeason !== null) throw new Error(`${definition.name} is no longer available`);
  if (!defeated) return {state: {...state}, points: 0};
  return {state: {...state, active: false, defeatedSeason: season, defeatedBy: challengerId}, points: definition.rewardPoints};
}

export function assertBossAssetsExcluded(assetIds: Iterable<string>, definitions: BossDefinition[]): void {
  const forbidden = new Set(definitions.flatMap(definition => definition.memberIds));
  const leaked = [...assetIds].filter(assetId => forbidden.has(assetId) || assetId.startsWith("boss-"));
  if (leaked.length) throw new Error(`Boss-only assets entered an acquisition pool: ${leaked.join(", ")}`);
}

export function openingQualifierRound(entrants: BossQualifierEntrant[]): {byes: BossQualifierEntrant[]; matches: Array<[BossQualifierEntrant, BossQualifierEntrant]>} {
  const ordered = [...entrants].sort((left, right) => left.seed - right.seed);
  if (ordered.length !== 30 || new Set(ordered.map(entrant => entrant.id)).size !== 30) throw new Error("Red qualifier requires 30 unique teams");
  const byes = ordered.slice(0, 2);
  const field = ordered.slice(2);
  const matches: Array<[BossQualifierEntrant, BossQualifierEntrant]> = [];
  for (let index = 0; index < field.length / 2; index += 1) matches.push([field[index], field[field.length - 1 - index]]);
  return {byes, matches};
}

export function seededKnockoutRound(entrants: BossQualifierEntrant[]): Array<[BossQualifierEntrant, BossQualifierEntrant]> {
  if (entrants.length < 2 || entrants.length % 2) throw new Error("Knockout round requires an even field");
  const ordered = [...entrants].sort((left, right) => left.seed - right.seed);
  return Array.from({length: ordered.length / 2}, (_, index) => [ordered[index], ordered[ordered.length - 1 - index]]);
}

/** Every active team is eligible; the seeded rotation prevents one club from always moving first. */
export function openChallengeOrder(entrants: BossQualifierEntrant[], season: number): BossQualifierEntrant[] {
  if (!Number.isInteger(season) || season < 1) throw new Error("Season must be a positive integer");
  const ordered = [...entrants].sort((left, right) => left.seed - right.seed);
  if (!ordered.length || new Set(ordered.map(entrant => entrant.id)).size !== ordered.length) throw new Error("Challenge order requires unique teams");
  const offset = (season - 1) % ordered.length;
  return [...ordered.slice(offset), ...ordered.slice(0, offset)];
}

/** Preference is chosen by the manager; only equal-preference volunteers are lot-drawn. */
export function volunteerChallengeOrder(volunteers: BossVolunteer[], lotterySeed: string): BossVolunteer[] {
  if (!lotterySeed) throw new Error("Volunteer lottery requires a public seed");
  if (!volunteers.length || new Set(volunteers.map(volunteer => volunteer.id)).size !== volunteers.length) throw new Error("Volunteer order requires unique teams");
  if (volunteers.some(volunteer => !Number.isInteger(volunteer.preference) || volunteer.preference < 1)) throw new Error("Volunteer preference must be a positive integer");
  return [...volunteers].sort((left, right) => left.preference - right.preference || lotteryValue(lotterySeed, left.id) - lotteryValue(lotterySeed, right.id) || left.seed - right.seed);
}

function lotteryValue(seed: string, id: string): number {
  let value = 2166136261;
  for (const character of `${seed}:${id}`) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
