import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd(), packageFile = path.join(root, "package.json"), readmeFile = path.join(root, "README.md"), baselineFile = path.join(root, "docs", "RELEASE_BASELINE.json");
const packageJson = read<any>(packageFile), scripts = packageJson.scripts ?? {}, sourceFiles = [
  "docs/AI_PIPELINE_CONTROL.md", "docs/CURRENT_STATUS_AND_ROADMAP.md", "src/ai/autonomousResearch.ts", "src/ai/formalValidation.ts", "src/ai/formalValidationPortfolio.ts", "src/ai/formalCanaryControl.ts", "src/ai/formalBattleCanaryAdapter.ts", "src/ai/pipelineDoctorPlan.ts", "src/ai/semanticDecisionTrace.ts", "src/ai/pipelineControl.ts", "src/cli/autonomousResearch.ts", "src/cli/formalValidation.ts", "src/cli/formalCanaryControl.ts", "src/cli/aiPipeline.ts", "src/cli/toolingDoctor.ts", "src/draft/formalLeagueRuntime.ts", "src/draft/dynastyStateStore.ts", "src/draft/dynastyStorageMaintenance.ts",
];
const versions = Object.fromEntries(sourceFiles.flatMap(file => [...fs.readFileSync(path.join(root, file), "utf8").matchAll(/export const ([A-Z][A-Z0-9_]*VERSION)\s*=\s*["'`]([^"'`]+)["'`]/g)].map(match => [match[1], match[2]])));
const inputs = Object.fromEntries(["package.json", "package-lock.json", "tsconfig.json", ...sourceFiles].sort().map(file => [file, sha(path.join(root, file))]));
const core = {schemaVersion: 1, project: packageJson.name, version: packageJson.version, runtime: {node: packageJson.engines?.node ?? null}, inventory: {scripts: Object.keys(scripts).length, smokeTests: Object.keys(scripts).filter(key => key.startsWith("smoke:")).length}, versions, inputs}, baseline = {...core, sha256: canonicalSha(core)};
fs.mkdirSync(path.dirname(baselineFile), {recursive: true}); atomic(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
const generated = [
  "<!-- GENERATED_STATUS:START -->",
  "## Verified Build Surface",
  "",
  `- Package baseline: \`${packageJson.name}@${packageJson.version}\``,
  `- Local command inventory: ${baseline.inventory.scripts} scripts, including ${baseline.inventory.smokeTests} smoke suites`,
  `- Autonomous research: \`${versions.AUTONOMOUS_RESEARCH_VERSION ?? "unknown"}\``,
  `- Formal validation: \`${versions.FORMAL_VALIDATION_VERSION ?? "unknown"}\``,
  `- Canary adapter protocol: \`${readProtocol()}\``,
  "- Formal canary authority: one battle decision domain, signed handoff, reviewed local adapter, manual promotion only",
  "- Formal inference: matchup-cluster votes across modern benchmark and current formal-league environments",
  "- Storage: content-addressed dynasty histories, independently reusable state fields, reference-audited dry-run GC",
  `- Machine-readable baseline: [\`docs/RELEASE_BASELINE.json\`](docs/RELEASE_BASELINE.json) (\`${baseline.sha256.slice(0, 12)}\`)`,
  "",
  "Regenerate this block and its signed baseline with `npm run baseline:generate`.",
  "<!-- GENERATED_STATUS:END -->",
].join("\n");
const current = fs.readFileSync(readmeFile, "utf8"), expression = /<!-- GENERATED_STATUS:START -->[\s\S]*?<!-- GENERATED_STATUS:END -->/;
const next = expression.test(current) ? current.replace(expression, generated) : current.replace(/(Current production capabilities[^\n]*\n)/, `$1\n${generated}\n`);
atomic(readmeFile, next); console.log(JSON.stringify({baseline: path.relative(root, baselineFile), sha256: baseline.sha256, scripts: baseline.inventory.scripts, smokeTests: baseline.inventory.smokeTests}, null, 2));

function readProtocol(): string { return fs.readFileSync(path.join(root, "src/ai/formalCanaryControl.ts"), "utf8").match(/FORMAL_CANARY_ADAPTER_PROTOCOL\s*=\s*"([^"]+)"/)?.[1] ?? "unknown"; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function sha(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function atomic(file: string, value: string): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
