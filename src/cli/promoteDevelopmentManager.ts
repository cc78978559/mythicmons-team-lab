import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import type {CareerMemoryCheckpoint} from "../draft/careerArchive";
import {cloneManagerProfile, type ManagerProfile} from "../draft/managerProfiles";
import type {LineageIdentity} from "../draft/naturalEvolution";

interface MajorManager {id: string; name: string; baseProfile: ManagerProfile; currentProfile: ManagerProfile; lineage: LineageIdentity; lineageHistory: LineageIdentity[]; titles: number; totalPoints: number; seasons: Array<{season: number; rank: number; points: number; champion: boolean}>}
interface MajorState {version: number; seed: string; completedSeason: number; settings: Record<string, number | string | boolean | undefined>; managers: MajorManager[]; fingerprint: CareerMemoryCheckpoint["source"]["fingerprint"]; registry?: {hash?: string; revision?: string; snapshot?: string}}
interface PromotionCandidate {slotId: string; childId: string; childName: string; parentId: string; parentName: string; rightsHolderId: string; optionYearsRemaining: number; currentProfile: ManagerProfile; lineage: LineageIdentity; lineageHistory: LineageIdentity[]; career: unknown[]}
interface PromotionPayload {schemaVersion: 1; source: Record<string, unknown>; candidates: PromotionCandidate[]}

const args = process.argv.slice(2), root = process.cwd();
const majorSource = path.resolve(requiredOption("--major-source"));
const promotionManifestPath = path.resolve(requiredOption("--promotion"));
const out = path.resolve(option("--out", "output/promoted-major-league"));
const replacementId = requiredOption("--replace");
const reason = requiredOption("--reason");
if (!["retirement", "relegation"].includes(reason)) throw new Error("--reason must be retirement or relegation");
const candidateIndex = integerOption("--candidate-index", 1, 1, 100) - 1;
const seasons = integerOption("--seasons", 1, 1, 12);
const major = read<MajorState>(path.join(majorSource, "dynasty-state.json"));
const outgoing = major.managers.find(manager => manager.id === replacementId);
if (!outgoing) throw new Error(`Major league has no vacancy target ${replacementId}`);
const promotion = loadPromotionPackage();
const candidate = promotion.candidates[candidateIndex];
if (!candidate) throw new Error(`Promotion package has no candidate ${candidateIndex + 1}`);
if (candidate.optionYearsRemaining < 0) throw new Error("Promotion candidate has invalid affiliate option years");
prepareOutput();

const checkpointManagers: CareerMemoryCheckpoint["managers"] = major.managers.map(manager => {
  if (manager.id !== replacementId) return {id: manager.id, name: manager.name, baseProfile: cloneManagerProfile(manager.baseProfile), currentProfile: cloneManagerProfile(manager.currentProfile), lineage: manager.lineage, lineageHistory: manager.lineageHistory};
  const profile = cloneManagerProfile(candidate.currentProfile);
  profile.id = manager.id; profile.name = candidate.childName; profile.tactics.id = manager.id;
  return {id: manager.id, name: candidate.childName, baseProfile: cloneManagerProfile(profile), currentProfile: profile, lineage: candidate.lineage, lineageHistory: candidate.lineageHistory};
});
const checkpoint = writeCheckpoint(checkpointManagers);
const transaction = {
  schemaVersion: 1,
  authorized: true,
  reason,
  vacancy: replacementId,
  outgoing: {id: outgoing.id, name: outgoing.name, lineage: outgoing.lineage, titles: outgoing.titles, totalPoints: outgoing.totalPoints, seasons: outgoing.seasons.length},
  incoming: {childId: candidate.childId, name: candidate.childName, lineage: candidate.lineage, parentId: candidate.parentId, parentName: candidate.parentName, rightsHolderId: candidate.rightsHolderId, optionYearsRemaining: candidate.optionYearsRemaining, developmentCareer: candidate.career},
  resets: ["major-league season record", "titles", "points", "contracts", "cash", "assets", "market"],
  preserves: ["all non-vacated manager personalities", "incoming development personality", "lineages", "learned memory", "strategy programs"],
};
writeJson(path.join(out, "promotion-transaction.json"), transaction);
runPromotedLeague(checkpoint);
verifyResult();
console.log(JSON.stringify({vacancy: replacementId, reason, outgoing: outgoing.name, incoming: candidate.childName, incomingLineage: candidate.lineage.lineageId, seasons, output: out}, null, 2));

function loadPromotionPackage(): PromotionPayload {
  const manifest = read<{archive: string; sha256: string; candidates: number}>(promotionManifestPath);
  const bytes = zlib.gunzipSync(fs.readFileSync(path.resolve(path.dirname(promotionManifestPath), manifest.archive)));
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== manifest.sha256) throw new Error(`Promotion package hash mismatch: ${hash} != ${manifest.sha256}`);
  const payload = JSON.parse(bytes.toString("utf8")) as PromotionPayload;
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.candidates) || payload.candidates.length !== manifest.candidates) throw new Error("Invalid promotion package");
  return payload;
}

function writeCheckpoint(managers: CareerMemoryCheckpoint["managers"]): string {
  const payload: CareerMemoryCheckpoint = {schemaVersion: 1, source: {seed: major.seed, completedSeason: major.completedSeason, stateVersion: major.version, fingerprint: major.fingerprint, registry: {hash: major.registry?.hash, revision: major.registry?.revision}}, managers};
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"), compressed = zlib.gzipSync(bytes, {level: 9});
  const archive = path.join(out, "promoted-major-checkpoint.json.gz"), manifest = path.join(out, "promoted-major-checkpoint.json");
  fs.writeFileSync(archive, compressed);
  writeJson(manifest, {schemaVersion: 1, archive: path.basename(archive), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), sourceBytes: bytes.length, compressedBytes: compressed.length, managers: managers.length});
  return manifest;
}

function runPromotedLeague(checkpoint: string): void {
  const settings = major.settings, registrySource = major.registry?.snapshot ? path.resolve(majorSource, major.registry.snapshot) : path.resolve(option("--registry", "data/draft"));
  const env = {...process.env, V12_OUT: path.join(out, "league"), V12_SEED: `${major.seed}:promotion:${candidate.childId}`, V12_SEASONS: String(seasons), V12_MANAGER_LIMIT: String(settings.managerLimit), V12_PAIRS: String(settings.pairs), V12_POOL_SIZE: String(settings.poolSize), V12_AUCTION_LOTS: String(settings.auctionLots), V12_REGULAR_ROUNDS: String(settings.regularRounds), V12_MAX_TURNS: String(settings.maxTurns), V12_MIN_ROSTER: String(settings.minRoster ?? 6), V12_MAX_ROSTER: String(settings.maxRoster ?? 10), V12_BASE_CASH: String(settings.baseBudget ?? 40), V12_REGISTRY_SOURCE: registrySource, V12_REGISTRY_REVISION: major.registry?.revision ?? "promotion", V12_CAREER_CHECKPOINT: checkpoint, V12_ALLOW_CODE_UPGRADE: "true", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
  const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Promoted major league failed:\n${run.stderr || run.stdout}`);
}

function verifyResult(): void {
  const state = read<{managers: MajorManager[]}>(path.join(out, "league", "dynasty-state.json"));
  const incoming = state.managers.find(manager => manager.id === replacementId);
  if (!incoming || incoming.lineage.lineageId !== candidate.lineage.lineageId || incoming.name !== candidate.childName) throw new Error("Promoted manager did not occupy the authorized vacancy");
  for (const sourceManager of major.managers.filter(manager => manager.id !== replacementId)) {
    const current = state.managers.find(manager => manager.id === sourceManager.id);
    if (!current || current.lineage.lineageId !== sourceManager.lineage.lineageId) throw new Error(`Non-vacated manager ${sourceManager.id} changed lineage during promotion`);
  }
}

function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Promotion output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || resolved === majorSource || majorSource.startsWith(`${resolved}${path.sep}`)) throw new Error(`Unsafe promotion output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function requiredOption(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
