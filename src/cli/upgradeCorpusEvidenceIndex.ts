import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {benchmarkPairClusterId, signBattleFamilyEvidence, verifyBattleFamilyEvidence, type BenchmarkBattleEvidence} from "../draft/benchmarkFamilies";
import {loadCorpusEvidenceAuthority, type CorpusEvidenceAuthorityKind} from "../draft/corpusEvidenceAuthority";
import {sha256} from "../showdown/evidenceEpoch";

const args = process.argv.slice(2), root = path.resolve(required("--root")), authority = required("--authority") as CorpusEvidenceAuthorityKind;
if (!(["research", "formal-holdout-only"] as string[]).includes(authority)) throw new Error("--authority must be research or formal-holdout-only");

function main(): void {
  const manifestFile = path.join(root, "corpus-manifest.json"), manifest = read<any>(manifestFile), evidenceFiles = find(root, "benchmark-evidence.json"); if (!evidenceFiles.length || manifest.results?.failures !== 0 || manifest.results?.complete !== evidenceFiles.length || manifest.settings?.jobs !== evidenceFiles.length) throw new Error("Only complete one-evidence-per-job family corpora can be upgraded");
  const prepared = evidenceFiles.map(file => { const game = path.dirname(file), value = read<any>(file), replay = path.join(game, "replay-input.json"), decisions = path.join(game, "ai-decisions.json"), end = path.join(game, "end.json"); if (![replay, decisions, end].every(fs.existsSync) || value.schemaVersion !== 1 || value.familyIds?.length !== 2 || value.pairClusterId !== benchmarkPairClusterId(value.split, value.familyIds) || authority === "formal-holdout-only" && value.split !== "holdout" || authority === "research" && value.split === "holdout") throw new Error(`Legacy family evidence cannot be upgraded safely: ${file}`); const {sha256: _oldSha, authority: _oldAuthority, ...legacyCore} = value, signed = signBattleFamilyEvidence({...legacyCore, authority} as Omit<BenchmarkBattleEvidence, "sha256">); verifyBattleFamilyEvidence(signed); return {file, game, replay, decisions, end, signed}; });
  for (const value of prepared) atomic(value.file, value.signed);
  const evidenceIndex = prepared.map(value => ({id: path.relative(root, value.game).replaceAll("\\", "/"), game: path.relative(root, value.game).replaceAll("\\", "/"), evidenceSha256: fileSha(value.file), replaySha256: fileSha(value.replay), decisionsSha256: fileSha(value.decisions), endSha256: fileSha(value.end), pairClusterId: value.signed.pairClusterId})).sort((a, b) => a.id.localeCompare(b.id)), {sha256: _oldManifestSha, ...oldCore} = manifest, manifestCore = {...oldCore, corpusVersion: "position-value-family-corpus-v3-case-index", index: {...oldCore.index, authority}, familyDesign: {...oldCore.familyDesign, splitAuthority: authority}, evidenceIndex}, upgraded = {...manifestCore, sha256: sha256(manifestCore)}; atomic(manifestFile, upgraded); const verified = loadCorpusEvidenceAuthority(root, authority); console.log(JSON.stringify({schemaVersion: 1, upgraded: true, root, authority, cases: verified.cases.size, clusters: verified.clusters.size, manifestSha256: verified.manifestSha256, authoritySha256: verified.sha256}, null, 2));
}
function find(directory: string, name: string): string[] { const result: string[] = [], stack = [directory]; while (stack.length) { const current = stack.pop()!; for (const entry of fs.readdirSync(current, {withFileTypes: true})) { const file = path.join(current, entry.name); if (entry.isDirectory()) stack.push(file); else if (entry.name === name) result.push(file); } } return result.sort(); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function fileSha(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
main();
