import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {assertJointBattleShadowCorpusArchive, assertJointBattleShadowSource, extractJointBattleShadowCorpus, type JointBattleShadowCorpusArchiveV1, type JointBattleShadowSourceAuthority, type JointBattleShadowSourceV1} from "../ai/jointBattleShadowCorpus";
import {assertApprovedProductionShadowSourceAuthority, assertProductionShadowSourceAuthorityManifest, buildProductionShadowSourceAuthorityManifest, productionShadowRecordSchemaSha256, type ProductionShadowSourceAuthorityManifestV1} from "../ai/productionShadowSourceAuthority";
import {acquireNamedRunLock} from "../draft/runLock";
import {parseArgs, stringArg} from "../showdown/args";

export const JOINT_BATTLE_SHADOW_EXECUTE_TOKEN = "build-relational-battle-policy-v1-shadow-corpus";
const archiveName = "joint-battle-shadow-corpus.json", lockName = ".joint-shadow-corpus.lock", maximumSourceBytes = 256 * 1024 * 1024;

const argv = process.argv.slice(2), command = argv[0] && !argv[0].startsWith("--") ? argv.shift()! : "status", args = parseArgs(argv);
try {
  if (command === "status") print(status(explicitAbsolute("out")));
  else if (command === "doctor") { const result = doctor(explicitAbsolute("out"), explicitRegularFile("manifest", 1024 * 1024)); print(result); if (!result.healthy) process.exitCode = 2; }
  else if (command === "propose") print(propose());
  else if (command === "inspect") print(inspect());
  else if (command === "build") print(build());
  else throw new Error("Usage: jointBattleShadowCorpus <status|doctor|propose|inspect|build> --out ABSOLUTE_DIR | --input ABSOLUTE_FILE [--manifest ABSOLUTE_FILE --approved-manifest-sha256 SHA --approval-reference-sha256 SHA --authority VALUE --signing-authority ID --execute-token TOKEN]");
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

function doctor(out: string, manifestFile: string): Record<string, unknown> { try { const manifest = readManifest(manifestFile); assertApprovalPins(manifest); const sourceSnapshot = readSourceSnapshot(boundedRegularFile(manifest.input.archive, maximumSourceBytes)); assertApprovedProductionShadowSourceAuthority(manifest, {inputArchive: sourceSnapshot.file, inputArchiveSha256: sourceSnapshot.rawSha256, logicalSourceSha256: sourceSnapshot.source.sha256, outputRoot: out, sourceAuthority: sourceSnapshot.source.sourceAuthority, signingAuthority: manifest.signingAuthority.id}); if (fs.existsSync(out)) { const stat = fs.lstatSync(out); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Joint shadow corpus output root must be a real directory"); } const archiveFile = path.join(out, archiveName); if (!fs.existsSync(archiveFile)) return {...summaryMissing(out), manifestStatus: manifest.status, manifestSha256: manifest.sha256}; const archive = readArchive(archiveFile), expected = extractJointBattleShadowCorpus(sourceSnapshot.source, manifest.sha256); if (archive.authorityManifestSha256 !== manifest.sha256 || archive.sha256 !== expected.sha256) throw new Error("Joint shadow corpus archive does not match the approved source and authority manifest"); return {...summary("available", out, archive), manifestStatus: manifest.status, manifestSha256: manifest.sha256}; } catch (error) { return {status: "invalid", available: fs.existsSync(path.join(out, archiveName)), healthy: false, out, error: error instanceof Error ? error.message : String(error), activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false}; } }

function propose(): ProductionShadowSourceAuthorityManifestV1 {
  const input = explicitInput(), out = explicitAbsolute("out"), sourceSnapshot = readSourceSnapshot(input), source = sourceSnapshot.source, authority = authorityArg(), signingAuthority = stringArg(args, "signing-authority"), approvalReferenceSha256 = stringArg(args, "approval-reference-sha256");
  if (inside(input, out) || source.sourceAuthority !== authority) throw new Error("Proposed production shadow source authority binding is invalid");
  const parentManifestSha256 = typeof args["parent-manifest-sha256"] === "string" ? args["parent-manifest-sha256"] as string : null;
  return buildProductionShadowSourceAuthorityManifest({status: "proposed", sourceAuthority: authority, lineage: {sourceSystem: stringArg(args, "source-system"), sourceGeneration: stringArg(args, "source-generation"), purpose: "joint-shadow-corpus-extraction-only", parentManifestSha256}, recordContract: {version: "unified-decision-record-v1", encoderVersion: "relational-battle-encoder-v1", schemaSha256: productionShadowRecordSchemaSha256()}, isolation: {informationModes: ["closed-sheet", "open-sheet"], familyClusterModeIsolation: true, familySplitIsolation: true}, input: {archive: input, archiveSha256: sourceSnapshot.rawSha256, logicalSourceSha256: source.sha256}, output: {root: out, retention: "retain-until-manual-safe-gc", recovery: "stale-lock-and-orphan-temp-only", overwrite: "reject-different-signed-archive"}, signingAuthority: {id: signingAuthority, scheme: "sha256-content-envelope", approvalReferenceSha256}});
}

function inspect(): Record<string, unknown> {
  if (typeof args.manifest === "string") { const manifestFile = explicitRegularFile("manifest", 1024 * 1024), manifest = readManifest(manifestFile); return {status: manifest.status, healthy: manifest.status === "approved", manifest: manifestFile, sourceAuthority: manifest.sourceAuthority, signingAuthority: manifest.signingAuthority.id, recordSchemaSha256: manifest.recordContract.schemaSha256, inputArchiveSha256: manifest.input.archiveSha256, outputRoot: manifest.output.root, sha256: manifest.sha256, trainingAllowed: false, routingAllowed: false, formalActivationAllowed: false}; }
  const input = explicitInput();
  const source = readSourceSnapshot(input).source;
  return {status: "valid", healthy: true, input, sourceAuthority: source.sourceAuthority, records: source.entries.length, candidates: source.entries.reduce((sum, entry) => sum + entry.labels.length, 0), informationModes: countModes(source), sha256: source.sha256, activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false};
}

function build(): Record<string, unknown> {
  if (stringArg(args, "execute-token") !== JOINT_BATTLE_SHADOW_EXECUTE_TOKEN) throw new Error("Invalid explicit joint shadow corpus execute token");
  const input = explicitInput(), manifestFile = explicitRegularFile("manifest", 1024 * 1024), out = explicitAbsolute("out"), authority = authorityArg(), signingAuthority = stringArg(args, "signing-authority");
  if (inside(input, out) || inside(manifestFile, out)) throw new Error("Joint shadow corpus inputs must be outside the output root");
  const sourceSnapshot = readSourceSnapshot(input), source = sourceSnapshot.source;
  if (source.sourceAuthority !== authority) throw new Error("Joint shadow corpus authority does not match the signed source");
  const manifest = readManifest(manifestFile);
  assertApprovalPins(manifest);
  assertApprovedProductionShadowSourceAuthority(manifest, {inputArchive: input, inputArchiveSha256: sourceSnapshot.rawSha256, logicalSourceSha256: source.sha256, outputRoot: out, sourceAuthority: authority, signingAuthority});
  const archive = extractJointBattleShadowCorpus(source, manifest.sha256);
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
  return explicitRegularFile("input", maximumSourceBytes);
}
function explicitRegularFile(name: string, maximumBytes: number): string { return boundedRegularFile(explicitAbsolute(name), maximumBytes, `--${name}`); }
function boundedRegularFile(file: string, maximumBytes: number, label = "file"): string { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw new Error(`${label} must be a bounded regular file`); return path.normalize(file); }
function explicitAbsolute(name: string): string { const raw = stringArg(args, name); if (!path.isAbsolute(raw)) throw new Error(`--${name} must be an explicit absolute path`); return path.normalize(raw); }
function authorityArg(): JointBattleShadowSourceAuthority { const value = stringArg(args, "authority"); if (!(["signed-research-family-corpus", "synthetic-test"] as string[]).includes(value)) throw new Error("Invalid joint shadow corpus authority"); return value as JointBattleShadowSourceAuthority; }
function assertApprovalPins(manifest: ProductionShadowSourceAuthorityManifestV1): void { const manifestSha256 = stringArg(args, "approved-manifest-sha256"), approvalReferenceSha256 = stringArg(args, "approval-reference-sha256"); if (!/^[a-f0-9]{64}$/.test(manifestSha256) || !/^[a-f0-9]{64}$/.test(approvalReferenceSha256) || manifest.sha256 !== manifestSha256 || manifest.signingAuthority.approvalReferenceSha256 !== approvalReferenceSha256) throw new Error("Production shadow authority approval pins do not match"); }
function readSourceSnapshot(file: string): {file: string; rawSha256: string; source: JointBattleShadowSourceV1} { const bytes = readBoundedBytes(file, maximumSourceBytes, "Joint shadow source"), source = JSON.parse(bytes.toString("utf8")) as JointBattleShadowSourceV1; assertJointBattleShadowSource(source); return {file: path.normalize(file), rawSha256: crypto.createHash("sha256").update(bytes).digest("hex"), source}; }
function readManifest(file: string): ProductionShadowSourceAuthorityManifestV1 { const value = JSON.parse(fs.readFileSync(file, "utf8")) as ProductionShadowSourceAuthorityManifestV1; assertProductionShadowSourceAuthorityManifest(value); return value; }
function readArchive(file: string): JointBattleShadowCorpusArchiveV1 { const value = JSON.parse(readBoundedBytes(file, maximumSourceBytes, "Joint shadow corpus archive").toString("utf8")) as JointBattleShadowCorpusArchiveV1; assertJointBattleShadowCorpusArchive(value); return value; }
function readBoundedBytes(file: string, maximumBytes: number, label: string): Buffer { const descriptor = fs.openSync(file, "r"); try { const stat = fs.fstatSync(descriptor); if (!stat.isFile() || stat.size > maximumBytes) throw new Error(`${label} exceeds the bounded input limit`); const bytes = fs.readFileSync(descriptor); if (bytes.length > maximumBytes) throw new Error(`${label} exceeds the bounded input limit`); return bytes; } finally { fs.closeSync(descriptor); } }
function countModes(source: JointBattleShadowSourceV1): {openSheet: number; closedSheet: number} { return {openSheet: source.entries.filter(entry => (entry.record.provenance.jointRelationalSnapshot as any).informationMode === "open-sheet").length, closedSheet: source.entries.filter(entry => (entry.record.provenance.jointRelationalSnapshot as any).informationMode === "closed-sheet").length}; }
function summaryMissing(out: string): Record<string, unknown> { return {status: "missing", available: false, healthy: false, out, activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false}; }
function summary(statusValue: string, out: string, archive: JointBattleShadowCorpusArchiveV1): Record<string, unknown> { return {status: statusValue, available: true, healthy: true, out, records: archive.acceptance.records, candidates: archive.corpus.metrics.candidates, informationModes: archive.informationModes, sourceSha256: archive.sourceSha256, authorityManifestSha256: archive.authorityManifestSha256, sha256: archive.sha256, activationStatus: archive.activationStatus, formalActivationAllowed: archive.formalActivationAllowed, routingAllowed: archive.routingAllowed}; }
function recoverTemporaryFiles(out: string): number { const files = fs.readdirSync(out).filter(name => name.startsWith(`${archiveName}.`) && name.endsWith(".tmp")); for (const name of files) fs.rmSync(path.join(out, name), {force: true}); return files.length; }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", flag: "wx"}); fs.renameSync(temporary, file); }
function inside(file: string, directory: string): boolean { const relative = path.relative(directory, file); return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative); }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
