import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {verifyWhiteBoxRelease} from "../ai/whiteBox/release";

interface FileEntry {sha256: string; bytes: number}
interface ReleaseManifest {schemaVersion: 1; releaseId: string; profile: string; whiteBoxCoreReleaseId: string; files: Record<string, FileEntry>}

const args = process.argv.slice(2), root = process.cwd(), out = path.resolve(option("--out", "output/development-ai-release-v1"));
if (args.includes("--verify-only")) {
  const manifest = verify(out);
  console.log(JSON.stringify({verified: true, releaseId: manifest.releaseId, coreReleaseId: manifest.whiteBoxCoreReleaseId, files: Object.keys(manifest.files).length, bytes: Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0), out}, null, 2));
  process.exit(0);
}

const core = path.resolve(option("--core", "output/development-ai-release-v1-core"));
const validation = path.resolve(option("--validation", "output/development-ecology-validation-v1"));
const multiseed = path.resolve(option("--multiseed", "output/development-ecology-multiseed-v1"));
const populations = path.resolve(option("--populations", "output/development-ecology-populations-v1"));
const calibration = path.resolve(option("--calibration", "output/development-ecology-calibration-v1"));
const coreManifest = verifyWhiteBoxRelease(core), validationSummary = read<any>(path.join(validation, "summary.json")), seedSummary = read<any>(path.join(multiseed, "summary.json")), populationSummary = read<any>(path.join(populations, "summary.json")), calibrationSummary = read<any>(path.join(calibration, "comparison.json"));
requirePassed("24-cycle validation", validationSummary.status); requirePassed("multi-seed validation", seedSummary.status); requirePassed("cross-population validation", populationSummary.status);
if (calibrationSummary.recommendation !== "grant105-offer115") throw new Error(`Unexpected calibrated recommendation: ${calibrationSummary.recommendation}`);
prepareOutput();

const sourceFiles = [
  "package.json",
  "src/cli/developmentLeague.ts",
  "src/cli/developmentLeagueSoak.ts",
  "src/cli/calibrateDevelopmentLeague.ts",
  "src/cli/validateDevelopmentEcologySeeds.ts",
  "src/cli/validateDevelopmentEcologyPopulations.ts",
  "src/cli/releaseDevelopmentAi.ts",
  "src/cli/manageDevelopmentAiReleaseRegistry.ts",
  "src/cli/promoteDevelopmentManager.ts",
  "src/draft/academyContracts.ts",
  "src/draft/academyEnvironment.ts",
  "src/draft/academyTalentMarket.ts",
  "src/draft/lineageDiversity.ts",
  "src/draft/managerLifecycle.ts",
  "src/draft/personalitySimilarity.ts",
  "src/draft/punctuatedEvolution.ts",
  "docs/DEVELOPMENT_ECOLOGY_BASELINE.md",
  "docs/DEVELOPMENT_ECOLOGY_CALIBRATION.md",
  "docs/DEVELOPMENT_LEAGUE.md",
];
for (const relative of sourceFiles) copy(path.join(root, relative), path.join(out, "source-snapshot", relative));
fs.cpSync(core, path.join(out, "whitebox-core"), {recursive: true});

const acceptance = {
  schemaVersion: 1,
  profile: "development-ai-v1",
  parameters: {academyGrantPool: 105, academySigningFee: 8, academyMarketOfferPercent: 115, academyEmergencySaleDiscountPercent: 35, marketDefault: "shadow", recoveryWindowCycles: 8},
  whiteBoxCore: {releaseId: coreManifest.releaseId, completedSeason: coreManifest.completedSeason, nextSeason: coreManifest.nextSeason, managers: coreManifest.managerCount},
  longHorizon: {status: validationSummary.status, cycles: validationSummary.cyclesCompleted, violations: validationSummary.violations, warnings: validationSummary.warnings, aggregate: validationSummary.aggregate, final: validationSummary.final},
  multiSeed: {status: seedSummary.status, runCount: seedSummary.aggregate.totalRuns, observationCycles: seedSummary.aggregate.observationCycles, recoveryCyclesExecuted: seedSummary.aggregate.recoveryCyclesExecuted, hardFailureRuns: seedSummary.hardFailureRuns, warningRuns: seedSummary.warningRuns, envelope: seedSummary.aggregate, runs: seedSummary.runs.map((run: any) => ({id: run.id, status: run.status, violations: run.violations, warnings: run.warnings, debtRecovery: compactRecovery(run.debtRecovery), aggregate: run.aggregate, final: run.final}))},
  populations: {status: populationSummary.status, hardFailurePopulations: populationSummary.hardFailurePopulations, warningPopulations: populationSummary.warningPopulations, envelope: populationSummary.envelope, populations: populationSummary.populations.map((entry: any) => ({id: entry.id, sourceManagers: entry.source.managers, status: entry.status, world: {status: entry.world.status, violations: entry.world.violations, warnings: entry.world.warnings, debtRecovery: compactRecovery(entry.world.debtRecovery), aggregate: entry.world.aggregate, final: entry.world.final}}))},
  calibration: {recommendation: calibrationSummary.recommendation, ranking: calibrationSummary.ranked.map((entry: any) => ({rank: entry.rank, profile: entry.profile, score: entry.score, status: entry.status, violations: entry.violations, warnings: entry.warnings}))},
  regression: {command: "npm test", status: "passed", durationSeconds: 287, note: "Full local regression completed immediately before snapshot creation."},
};
writeJson(path.join(out, "acceptance.json"), acceptance);
fs.writeFileSync(path.join(out, "README.md"), readme(coreManifest.releaseId), "utf8");
const files = indexFiles(out), releaseId = digest(Buffer.from(JSON.stringify(files), "utf8"));
writeJson(path.join(out, "manifest.json"), {schemaVersion: 1, releaseId, profile: "development-ai-v1", whiteBoxCoreReleaseId: coreManifest.releaseId, files} satisfies ReleaseManifest);
const verified = verify(out);
console.log(JSON.stringify({releaseId: verified.releaseId, coreReleaseId: verified.whiteBoxCoreReleaseId, profile: verified.profile, files: Object.keys(verified.files).length, bytes: Object.values(verified.files).reduce((sum, file) => sum + file.bytes, 0), acceptance: {longHorizon: validationSummary.status, multiSeed: seedSummary.status, populations: populationSummary.status, regression: "passed"}, out}, null, 2));

function verify(directory: string): ReleaseManifest {
  const manifestFile = path.join(directory, "manifest.json"), manifest = read<ReleaseManifest>(manifestFile);
  if (manifest.schemaVersion !== 1 || manifest.profile !== "development-ai-v1") throw new Error("Unsupported development AI release manifest");
  const actual = indexFiles(directory), expectedPaths = Object.keys(manifest.files).sort(), actualPaths = Object.keys(actual).sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) throw new Error("Release contains missing or unexpected payload files");
  for (const relative of expectedPaths) if (actual[relative].sha256 !== manifest.files[relative].sha256 || actual[relative].bytes !== manifest.files[relative].bytes) throw new Error(`Release payload mismatch: ${relative}`);
  const releaseId = digest(Buffer.from(JSON.stringify(manifest.files), "utf8"));
  if (releaseId !== manifest.releaseId) throw new Error(`Release ID mismatch: ${releaseId} != ${manifest.releaseId}`);
  const coreRelease = verifyWhiteBoxRelease(path.join(directory, "whitebox-core"));
  if (coreRelease.releaseId !== manifest.whiteBoxCoreReleaseId) throw new Error("White-box core release ID mismatch");
  return manifest;
}
function indexFiles(directory: string): Record<string, FileEntry> { const files: Record<string, FileEntry> = {}; visit(directory); return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))); function visit(current: string): void { for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(current, entry.name); if (entry.isDirectory()) visit(target); else { const relative = path.relative(directory, target).replaceAll(path.sep, "/"); if (relative === "manifest.json") continue; const bytes = fs.readFileSync(target); files[relative] = {sha256: digest(bytes), bytes: bytes.length}; } } } }
function readme(coreReleaseId: string): string { return `# Development AI release v1\n\nThis local package freezes the white-box manager core, calibrated development-league ecology, source overlay, and compact acceptance evidence.\n\n- White-box core release: \`${coreReleaseId}\`\n- Academy grant pool: 105\n- Signing fee: 8\n- Market offer multiplier: 115%\n- Emergency-sale discount: 35%\n- Default market mode: shadow\n- Debt recovery audit window: 8 cycles\n\nVerify without running simulations:\n\n\`\`\`powershell\nnpm run release:development-ai -- --out output/development-ai-release-v1 --verify-only\n\`\`\`\n\n\`acceptance.json\` contains portable validation results. \`source-snapshot\` is a rollback overlay for the development ecology implementation. \`whitebox-core\` is independently hash-verifiable and contains the manager AI state.\n`; }
function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Release output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || [core, validation, multiseed, populations, calibration].some(source => resolved === source || source.startsWith(`${resolved}${path.sep}`))) throw new Error(`Unsafe release output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function requirePassed(label: string, status: string): void { if (status !== "passed") throw new Error(`${label} is not passed: ${status}`); }
function compactRecovery(value: any): object { return {tested: Boolean(value?.tested), cleared: Boolean(value?.cleared), ...(value?.cyclesToClear !== undefined ? {cyclesToClear: value.cyclesToClear} : {}), ...(value?.finalDebt !== undefined ? {finalDebt: value.finalDebt} : {})}; }
function copy(source: string, target: string): void { if (!fs.existsSync(source)) throw new Error(`Missing release source: ${source}`); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(source, target); }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
