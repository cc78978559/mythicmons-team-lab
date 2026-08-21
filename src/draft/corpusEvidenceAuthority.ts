import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {sha256 as canonicalSha} from "../showdown/evidenceEpoch";
import {loadBattleFamilyEvidence, verifyBattleFamilyEvidence, type BenchmarkBattleEvidence} from "./benchmarkFamilies";

export type CorpusEvidenceAuthorityKind = "research" | "formal-holdout-only";

export interface CorpusEvidenceIndexEntry {
  id: string;
  game: string;
  evidenceSha256: string;
  replaySha256: string;
  decisionsSha256: string;
  endSha256: string;
  pairClusterId: string;
}

export interface AuthorizedCorpusCase extends CorpusEvidenceIndexEntry {
  absoluteGame: string;
  evidence: BenchmarkBattleEvidence;
}

export interface CorpusEvidenceAuthority {
  root: string;
  authority: CorpusEvidenceAuthorityKind;
  manifestSha256: string;
  manifestFileSha256: string;
  registrySha256: string;
  scheduleSha256: string;
  cases: ReadonlyMap<string, AuthorizedCorpusCase>;
  clusters: ReadonlySet<string>;
  sha256: string;
}

export function loadCorpusEvidenceAuthority(root: string, requiredAuthority: CorpusEvidenceAuthorityKind): CorpusEvidenceAuthority {
  const absoluteRoot = path.resolve(root), manifestFile = path.join(absoluteRoot, "corpus-manifest.json"), manifest = read<any>(manifestFile), {sha256: manifestSha256, ...manifestCore} = manifest;
  if (manifest.corpusVersion !== "position-value-family-corpus-v3-case-index" || !hex(manifestSha256) || canonicalSha(manifestCore) !== manifestSha256) throw new Error("Corpus manifest signature or indexed evidence version is invalid");
  if (manifest.index?.authority !== requiredAuthority || manifest.familyDesign?.splitAuthority !== requiredAuthority || manifest.results?.failures !== 0) throw new Error(`Corpus is not an error-free ${requiredAuthority} evidence pool`);
  if (!hex(manifest.familyDesign?.registrySha256) || !hex(manifest.familyDesign?.scheduleSha256)) throw new Error("Corpus family authority hashes are missing");
  if (!Array.isArray(manifest.evidenceIndex) || !manifest.evidenceIndex.length) throw new Error("Corpus has no per-case evidence index");
  const cases = new Map<string, AuthorizedCorpusCase>(), ids = new Set<string>(), clusters = new Set<string>();
  for (const raw of manifest.evidenceIndex as CorpusEvidenceIndexEntry[]) {
    if (!raw?.id || ids.has(raw.id) || !raw.game || cases.has(normalize(raw.game)) || ![raw.evidenceSha256, raw.replaySha256, raw.decisionsSha256, raw.endSha256].every(hex)) throw new Error(`Invalid or duplicate corpus evidence index entry: ${raw?.id ?? "unknown"}`);
    const absoluteGame = contained(absoluteRoot, raw.game), evidenceFile = path.join(absoluteGame, "benchmark-evidence.json"), replayFile = path.join(absoluteGame, "replay-input.json"), decisionsFile = path.join(absoluteGame, "ai-decisions.json"), endFile = path.join(absoluteGame, "end.json");
    if (fileSha(evidenceFile) !== raw.evidenceSha256 || fileSha(replayFile) !== raw.replaySha256 || fileSha(decisionsFile) !== raw.decisionsSha256 || fileSha(endFile) !== raw.endSha256) throw new Error(`Indexed corpus case drifted: ${raw.id}`);
    const evidence = loadBattleFamilyEvidence(absoluteGame, true); if (!evidence) throw new Error(`Corpus case lacks signed family evidence: ${raw.id}`); verifyBattleFamilyEvidence(evidence);
    const expectedSplit = requiredAuthority === "formal-holdout-only" ? "holdout" : null;
    if (evidence.authority !== requiredAuthority || expectedSplit && evidence.split !== expectedSplit || requiredAuthority === "research" && evidence.split === "holdout" || evidence.registrySha256 !== manifest.familyDesign.registrySha256 || evidence.scheduleSha256 !== manifest.familyDesign.scheduleSha256 || evidence.pairClusterId !== raw.pairClusterId) throw new Error(`Corpus case authority mismatch: ${raw.id}`);
    const key = normalize(path.relative(absoluteRoot, absoluteGame)); ids.add(raw.id); clusters.add(raw.pairClusterId); cases.set(key, {...raw, game: key, absoluteGame, evidence});
  }
  if (manifest.results.complete !== cases.size || manifest.settings?.jobs !== cases.size) throw new Error("Corpus case index does not cover every declared job");
  const core = {authority: requiredAuthority, manifestSha256, manifestFileSha256: fileSha(manifestFile), registrySha256: manifest.familyDesign.registrySha256, scheduleSha256: manifest.familyDesign.scheduleSha256, cases: [...cases.values()].map(value => ({id: value.id, game: value.game, evidenceSha256: value.evidenceSha256, replaySha256: value.replaySha256, decisionsSha256: value.decisionsSha256, endSha256: value.endSha256, pairClusterId: value.pairClusterId})).sort((a, b) => a.id.localeCompare(b.id))};
  return {root: absoluteRoot, authority: requiredAuthority, manifestSha256, manifestFileSha256: core.manifestFileSha256, registrySha256: core.registrySha256, scheduleSha256: core.scheduleSha256, cases, clusters, sha256: canonicalSha(core)};
}

export function authorizedCorpusCase(authority: CorpusEvidenceAuthority, game: string): AuthorizedCorpusCase | null {
  const relative = normalize(path.relative(authority.root, path.resolve(game))); return relative.startsWith("../") || relative === ".." ? null : authority.cases.get(relative) ?? null;
}

function contained(root: string, relative: string): string { const resolved = path.resolve(root, ...normalize(relative).split("/")), back = path.relative(root, resolved); if (!back || back.startsWith("..") || path.isAbsolute(back)) throw new Error(`Corpus evidence path escapes or aliases its root: ${relative}`); return resolved; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function fileSha(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function normalize(value: string): string { return value.replaceAll("\\", "/").replace(/^\.\//, ""); }
function hex(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
