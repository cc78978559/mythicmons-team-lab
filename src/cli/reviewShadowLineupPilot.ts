import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {evaluateLineupPilotEvidence, lineupPilotReviewMarkdown, type LineupPilotEvidenceSample, type LineupPilotReview} from "../ai/whiteBox/lineupPilotReview";
import type {LineupPilotPlan} from "../ai/whiteBox/lineupPilot";

const args = process.argv.slice(2);
const pilot = path.resolve(option("--pilot", "output/tooling/shadow-lineup-pilot"));
const out = path.resolve(option("--out", path.join(pilot, "promotion-review")));
const planFile = path.join(pilot, "pilot-plan.json"), manifestFile = path.join(pilot, "pilot-manifest.json");
const plan = read<LineupPilotPlan>(planFile), manifest = read<any>(manifestFile);
const issues: LineupPilotReview["issues"] = [], samples: LineupPilotEvidenceSample[] = [];
const planned = new Map(plan.selected.map(entry => [entry.id, entry]));

if (plan.schemaVersion !== 1 || manifest.schemaVersion !== 1) issues.push(fatal("schema", "Unsupported pilot plan or manifest schema"));
if (path.resolve(plan.source) !== path.resolve(manifest.source)) issues.push(fatal("source-binding", "Plan and manifest source roots differ"));
if (new Set(plan.selected.map(entry => entry.id)).size !== plan.selected.length) issues.push(fatal("duplicate-plan-id", "Pilot plan contains duplicate case ids"));
for (const item of manifest.items ?? []) {
  const selected = planned.get(String(item.id));
  if (!selected) {
    issues.push(fatal("manifest-plan-drift", `Manifest item is absent from plan: ${item.id}`));
    continue;
  }
  if (item.status === "failed") issues.push(warning("failed-run", `Pilot run failed and remains incomplete: ${item.id}`));
  if (item.status !== "complete") continue;
  try {
    const archive = path.resolve(String(item.output ?? ""));
    if (!archive.startsWith(`${pilot}${path.sep}`) || path.basename(archive) !== "counterfactual-evidence.json.gz") throw new Error(`Unsafe or unexpected capsule path: ${archive}`);
    const caseRoot = path.dirname(archive);
    if (fs.existsSync(path.join(caseRoot, "incumbent")) || fs.existsSync(path.join(caseRoot, "whitebox"))) throw new Error(`Uncompacted branch remains for ${item.id}`);
    const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8"));
    if (capsule.schemaVersion !== 1) throw new Error("Unsupported capsule schema");
    if (String(capsule.summary?.decisionId) !== selected.decisionId || String(capsule.summary?.managerId) !== selected.actor || Number(capsule.summary?.season) !== selected.season) throw new Error("Capsule identity differs from pilot plan");
    if (path.resolve(String(capsule.summary?.source ?? "")) !== path.resolve(plan.source)) throw new Error("Capsule source differs from pilot plan");
    const seasonFile = path.join(plan.source, `season-${String(selected.season).padStart(2, "0")}`, "season.json");
    const sourceVerified = fileHash(seasonFile) === String(capsule.hashes?.controlSeason ?? "");
    const interventionVerified = String(capsule.interventionRecord?.context?.whiteBoxLineupExperiment?.trace?.decisionId ?? "") === selected.decisionId;
    const causal = capsule.battleCausalSignature, direction = String(capsule.summary?.localOutcome?.direction ?? "");
    if (direction !== "better" && direction !== "neutral" && direction !== "worse") throw new Error(`Unknown local direction: ${direction}`);
    if (item.result?.direction && String(item.result.direction) !== direction) throw new Error("Manifest and capsule directions differ");
    const currentState = path.join(plan.source, "dynasty-state.json");
    if (fs.existsSync(currentState) && fileHash(currentState) !== String(capsule.hashes?.sourceState ?? "")) issues.push(warning("source-head-advanced", `Source head differs from capture time for ${item.id}; target season remains hash-bound`));
    samples.push({
      id: selected.id,
      managerId: selected.actor,
      season: selected.season,
      era: selected.era,
      sourceOutcome: selected.sourceOutcome,
      scaleBand: selected.scaleBand,
      marginBand: selected.marginBand,
      direction,
      prefixVerified: capsule.summary?.prefixVerified === true,
      sourceVerified,
      interventionVerified,
      causalAvailable: causal?.available === true,
      games: integer(causal?.summary?.games),
      actionDivergences: integer(causal?.summary?.actionDivergences),
      unusedSubstitutions: integer(causal?.summary?.unusedSubstitutions),
      outcomeChanges: integer(causal?.summary?.outcomeChanges),
    });
  } catch (error) {
    issues.push(fatal("capsule-integrity", `${item.id}: ${error instanceof Error ? error.message : String(error)}`));
  }
}
const review = evaluateLineupPilotEvidence(samples, plan.selected.length, issues);
const evidence = {
  ...review,
  bindings: {
    plan: planFile,
    planSha256: fileHash(planFile),
    manifest: manifestFile,
    manifestSha256: fileHash(manifestFile),
    source: plan.source,
  },
};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-promotion-review.json"), evidence);
fs.writeFileSync(path.join(out, "lineup-promotion-review.md"), lineupPilotReviewMarkdown(review), "utf8");
write(path.join(out, "token-budget.json"), {
  schemaVersion: 1,
  compactReviewBytes: fs.statSync(path.join(out, "lineup-promotion-review.json")).size,
  estimatedTokens: Math.ceil(fs.statSync(path.join(out, "lineup-promotion-review.json")).size / 4),
  recommendedRead: path.join(out, "lineup-promotion-review.md"),
});
console.log(JSON.stringify({
  conclusion: review.conclusion,
  completed: review.metrics.completed,
  planned: review.metrics.planned,
  better: review.metrics.better,
  neutral: review.metrics.neutral,
  worse: review.metrics.worse,
  expressionRate: review.metrics.expressionRate,
  fatal: review.issues.filter(issue => issue.severity === "fatal").length,
  warnings: review.issues.filter(issue => issue.severity === "warning").length,
  report: path.join(out, "lineup-promotion-review.md"),
}, null, 2));

function fatal(code: string, message: string): LineupPilotReview["issues"][number] { return {severity: "fatal", code, message}; }
function warning(code: string, message: string): LineupPilotReview["issues"][number] { return {severity: "warning", code, message}; }
function integer(value: unknown): number { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error(`Invalid causal count: ${value}`); return number; }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing pilot input: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
