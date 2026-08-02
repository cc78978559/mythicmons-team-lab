import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {reviewLineupRepresentationOutcomes, screenResidualLineupOutcomes, type LineupRepresentationOutcomePair, type LineupRepresentationResidualRow} from "../ai/whiteBox/lineupRepresentationOutcomeReview";

const args = process.argv.slice(2);
const input = path.resolve(option("--input", "output/tooling/shadow-lineup-representation-efficiency/lineup-representation-study-samples.json.gz"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-representation-outcomes"));
const study = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)).toString("utf8"));
const groups = new Map<string, any[]>();
for (const row of study.rows ?? []) {
  const key = `${row.season}:${row.seriesId}`, group = groups.get(key) ?? [];
  group.push(row); groups.set(key, group);
}
const allPairs: LineupRepresentationOutcomePair[] = [], residualRows: LineupRepresentationResidualRow[] = [];
let excludedDraw = 0, excludedMissing = 0, excludedMalformed = 0;
for (const [id, rows] of groups) {
  const winner = rows.find(row => row.outcome === "win"), loser = rows.find(row => row.outcome === "loss");
  if (!winner || !loser) {
    if (rows.some(row => row.outcome === "missing")) excludedMissing++;
    else if (rows.some(row => row.outcome === "draw")) excludedDraw++;
    else excludedMalformed++;
    continue;
  }
  const winnerDiagnostics = incumbentDiagnostics(winner), loserDiagnostics = incumbentDiagnostics(loser);
  if (!winnerDiagnostics || !loserDiagnostics) { excludedMalformed++; continue; }
  const featureDeltas: Record<string, number> = {};
  for (const feature of new Set([...Object.keys(winnerDiagnostics), ...Object.keys(loserDiagnostics)])) {
    if (feature === "lineup.representationVersion") continue;
    featureDeltas[feature] = round(Number(winnerDiagnostics[feature] ?? 0) - Number(loserDiagnostics[feature] ?? 0));
  }
  allPairs.push({id, season: Number(winner.season), managers: [String(winner.managerId), String(loser.managerId)], featureDeltas});
  const ordered = [winner, loser].sort((left, right) => String(left.managerId).localeCompare(String(right.managerId)));
  const leftFeatures = incumbentDiagnostics(ordered[0]), rightFeatures = incumbentDiagnostics(ordered[1]);
  if (leftFeatures && rightFeatures) residualRows.push({
    id,
    season: Number(winner.season),
    leftManager: String(ordered[0].managerId),
    rightManager: String(ordered[1].managerId),
    outcome: ordered[0].outcome === "win" ? 1 : -1,
    leftFeatures,
    rightFeatures,
  });
}
const independentPairs: LineupRepresentationOutcomePair[] = [], usedManagers = new Set<string>();
for (const pair of [...allPairs].sort((left, right) => digest(left.id).localeCompare(digest(right.id)))) {
  if (pair.managers.some(manager => usedManagers.has(manager))) continue;
  independentPairs.push(pair);
  pair.managers.forEach(manager => usedManagers.add(manager));
}
const review = reviewLineupRepresentationOutcomes(allPairs, independentPairs);
const residualScreen = screenResidualLineupOutcomes(residualRows);
const combinedConclusion = residualScreen.candidateFeatures ? "candidate-associations-found" : review.conclusion;
const result = {...review, conclusion: combinedConclusion, managerDisjointConclusion: review.conclusion, residualScreen, exclusions: {drawSeries: excludedDraw, missingSeries: excludedMissing, malformedSeries: excludedMalformed}, input};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-representation-outcome-review.json"), result);
const report = [
  "# Lineup Representation Outcome Review",
  "",
  `- Conclusion: ${combinedConclusion}`,
  `- Manager-disjoint screen: ${review.conclusion}`,
  `- Descriptive decisive series: ${review.metrics.allPairs}`,
  `- Independent series/managers: ${review.metrics.independentPairs}/${review.metrics.independentManagers}`,
  `- Candidate features: ${review.metrics.candidateFeatures}/${review.metrics.features}`,
  `- Within-manager residual candidates: ${residualScreen.candidateFeatures}/${residualScreen.features.length}`,
  `- Excluded draw/missing/malformed series: ${excludedDraw}/${excludedMissing}/${excludedMalformed}`,
  "",
  "| Diagnostic | All non-zero | Winner-higher | Independent non-zero | Seasons | Orientation | Concordant | p | q | Candidate |",
  "|---|---:|---:|---:|---:|---|---:|---:|---:|---|",
  ...review.features.map(feature => `| ${feature.feature} | ${feature.allNonZero}/${feature.allPairs} | ${(feature.allWinnerHigherRate * 100).toFixed(1)}% | ${feature.independentNonZero}/${feature.independentPairs} | ${feature.seasons} | ${feature.orientation} | ${feature.concordant}/${feature.independentNonZero} | ${feature.exactP.toFixed(4)} | ${feature.adjustedQ.toFixed(4)} | ${feature.candidateForCausalStudy} |`),
  "",
  "## Within-manager residual screen",
  "",
  "| Diagnostic | Pairs | Effect | Orientation | Permutation p | q | Candidate |",
  "|---|---:|---:|---|---:|---:|---|",
  ...residualScreen.features.map(feature => `| ${feature.feature} | ${feature.pairs} | ${feature.standardizedEffect.toFixed(4)} | ${feature.orientation} | ${feature.permutationP.toFixed(4)} | ${feature.adjustedQ.toFixed(4)} | ${feature.candidateForCausalStudy} |`),
  "",
  "## Findings",
  "",
  ...review.findings.map(finding => `- ${finding}`),
  "",
].join("\n");
fs.writeFileSync(path.join(out, "lineup-representation-outcome-review.md"), report, "utf8");
write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportBytes: Buffer.byteLength(report), estimatedReportTokens: Math.ceil(Buffer.byteLength(report) / 4), rawBattleLogsRead: 0});
console.log(JSON.stringify({conclusion: combinedConclusion, managerDisjointConclusion: review.conclusion, ...review.metrics, residualCandidates: residualScreen.candidateFeatures, exclusions: result.exclusions, report: path.join(out, "lineup-representation-outcome-review.md")}, null, 2));

function incumbentDiagnostics(row: any): Record<string, number> | undefined { return row.candidates?.find((candidate: any) => String(candidate.id) === String(row.comparison?.incumbent))?.diagnostics; }
function digest(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
