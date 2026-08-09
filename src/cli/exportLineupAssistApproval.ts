import fs from "node:fs";
import path from "node:path";
import {buildLineupAssistApproval, loadLineupAssistApproval} from "../ai/whiteBox/lineupApproval";
import type {LineupAuditHypothesis} from "../ai/whiteBox/lineupHypothesisWorkbench";

const args = process.argv.slice(2), study = path.resolve(required("--study")), hypothesesFile = path.resolve(required("--hypotheses")), hypothesisId = required("--hypothesis"), out = path.resolve(option("--out", "output/lineup-assist-approval.json"));
if (fs.existsSync(out)) throw new Error(`Approval output already exists: ${out}`);
const source = JSON.parse(fs.readFileSync(hypothesesFile, "utf8")), hypotheses: LineupAuditHypothesis[] = source.hypotheses ?? source.promotedHypotheses ?? [];
const hypothesis = hypotheses.find(value => value.id === hypothesisId); if (!hypothesis) throw new Error(`Hypothesis not found: ${hypothesisId}`);
const approval = buildLineupAssistApproval(study, hypothesis, {applicationRate: numberOption("--rate", .1, .001, .5), maximumApplicationsPerSeason: integerOption("--max-applications", 12, 1, 100), firstSeason: integerOption("--first-season", 1, 1, 100000), expiresAfterSeason: integerOption("--expires-after-season", 1, 1, 100000), minimumHypothesisScoreDelta: numberOption("--minimum-score-delta", .02, .001, .5), maximumRationalRegression: numberOption("--maximum-rational-regression", .05, 0, .5)});
fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, `${JSON.stringify(approval, null, 2)}\n`, "utf8"); loadLineupAssistApproval(out); console.log(JSON.stringify({out, sha256: approval.sha256, hypothesisId, canary: approval.payload.canary, safety: approval.payload.safety}, null, 2));
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function numberOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = numberOption(name, fallback, minimum, maximum); if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`); return value; }
