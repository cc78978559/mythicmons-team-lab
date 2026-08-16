import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {assertJointBattleShadowCorpusArchive, assertJointBattleShadowSource, extractJointBattleShadowCorpus, type JointBattleShadowCorpusArchiveV1, type JointBattleShadowSourceAuthority, type JointBattleShadowSourceV1} from "../ai/jointBattleShadowCorpus";
import {acquireNamedRunLock} from "../draft/runLock";
import {parseArgs, stringArg} from "../showdown/args";

export const JOINT_BATTLE_SHADOW_EXECUTE_TOKEN = "build-relational-battle-policy-v1-shadow-corpus";
const archiveName = "joint-battle-shadow-corpus.json", lockName = ".joint-shadow-corpus.lock", maximumSourceBytes = 256 * 1024 * 1024;

const argv = process.argv.slice(2), command = argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "status", args = parseArgs(argv);
try {
  if (command === "status") print(status(explicitAbsolute("out")));
  else if (command === "doctor") { const result = doctor(explicitAbsolute("out")); print(result); if (!result.healthy) process.exitCode = 2; }
  else if (command === "inspect") print(inspect(explicitInput()));
  else if (command === "build") print(build());
  else throw new Error("Usage: jointBattleShadowCorpus <status|doctor|inspect|build> --out ABSOLUTE_DIR | --input ABSOLUTE_FILE [--authority signed-research-family-corpus|synthetic-test --execute-token TOKEN]");
} catch (error) {
  console.error(JSON.stringify({status: "rejected", error: error instanceof Error ? error.message : String(error)}, null, 2));
  process.exitCode = 2;
}

function status(out: string): Record<string, unknown> {
  if (fs.existsSync(out)) { const stat = fs.lstatSync(out); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Joint shadow corpus output root must be a real directory"); }
  const file = path.join(out, archiveName);
  if (!fs.existsSync(file)) return {status: "missing", available: false, healthy: false, out, activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false};
  try { const archive = readArchive(file); return summary("available", out, archive); }
  catch (error) { return {status: "invalid", available: true, healthy: false, out, error: error instanceof Error ? error.message : String(error), activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false}; }
}

function doctor(out: string): Record<string, unknown> { return status(out); }

function inspect(input: string): Record<string, unknown> {
  const source = readSource(input), archive = extractJointBattleShadowCorpus(source);
  return {status: "valid", healthy: true, input, sourceAuthority: source.sourceAuthority, records: source.entries.length, candidates: archive.corpus.metrics.candidates, informationModes: archive.informationModes, sha256: source.sha256, activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false};
}

function build(): Record<string, unknown> {
  if (stringArg(args, "execute-token") !== JOINT_BATTLE_SHADOW_EXECUTE_TOKEN) throw new Error("Invalid explicit joint shadow corpus execute token");
  const input = explicitInput(), out = explicitAbsolute("out"), authority = authorityArg();
  if (inside(input, out)) throw new Error("Joint shadow corpus input must be outside the output root");
  const source = readSource(input);
  if (source.sourceAuthority !== authority) throw new Error("Joint shadow corpus authority does not match the signed source");
  const archive = extractJointBattleShadowCorpus(source);
  if (fs.existsSync(out)) { const stat = fs.lstatSync(out); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Joint shadow corpus output root must be a real directory"); }
  fs.mkdirSync(out, {recursive: true});
  const lock = acquireNamedRunLock(out, lockName, {authority, sourceSha256: source.sha256});
  try {
    const recoveredTemporaryFiles = recoverTemporaryFiles(out), file = path.join(out, archiveName);
    if (fs.existsSync(file)) {
      const existing = readArchive(file);
      if (existing.sourceSha256 !== source.sha256 || existing.sha256 !== archive.sha256) throw new Error("Joint shadow corpus output already contains a different signed archive");
      return {...summary("cached", out, existing), recoveredTemporaryFiles};
    }
    atomicJson(file, archive);
    const persisted = readArchive(file);
    if (persisted.sha256 !== archive.sha256) throw new Error("Persisted joint shadow corpus signature changed");
    return {...summary("complete", out, persisted), recoveredTemporaryFiles};
  } finally { lock.release(); }
}

function explicitInput(): string {
  const input = explicitAbsolute("input"), stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumSourceBytes) throw new Error("Joint shadow corpus input must be a bounded regular file");
  return input;
}
function explicitAbsolute(name: string): string { const raw = stringArg(args, name); if (!path.isAbsolute(raw)) throw new Error(`--${name} must be an explicit absolute path`); return path.normalize(raw); }
function authorityArg(): JointBattleShadowSourceAuthority { const value = stringArg(args, "authority"); if (!(["signed-research-family-corpus", "synthetic-test"] as string[]).includes(value)) throw new Error("Invalid joint shadow corpus authority"); return value as JointBattleShadowSourceAuthority; }
function readSource(file: string): JointBattleShadowSourceV1 { const value = JSON.parse(fs.readFileSync(file, "utf8")) as JointBattleShadowSourceV1; assertJointBattleShadowSource(value); return value; }
function readArchive(file: string): JointBattleShadowCorpusArchiveV1 { const value = JSON.parse(fs.readFileSync(file, "utf8")) as JointBattleShadowCorpusArchiveV1; assertJointBattleShadowCorpusArchive(value); return value; }
function summary(statusValue: string, out: string, archive: JointBattleShadowCorpusArchiveV1): Record<string, unknown> { return {status: statusValue, available: true, healthy: true, out, records: archive.acceptance.records, candidates: archive.corpus.metrics.candidates, informationModes: archive.informationModes, sourceSha256: archive.sourceSha256, sha256: archive.sha256, activationStatus: archive.activationStatus, formalActivationAllowed: archive.formalActivationAllowed, routingAllowed: archive.routingAllowed}; }
function recoverTemporaryFiles(out: string): number { const files = fs.readdirSync(out).filter(name => name.startsWith(`${archiveName}.`) && name.endsWith(".tmp")); for (const name of files) fs.rmSync(path.join(out, name), {force: true}); return files.length; }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", flag: "wx"}); fs.renameSync(temporary, file); }
function inside(file: string, directory: string): boolean { const relative = path.relative(directory, file); return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative); }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
