import fs from "node:fs";
import path from "node:path";
import {auditLineupRepresentation, type LineupRepresentationObservation} from "../ai/whiteBox/lineupRepresentationAudit";

const args = process.argv.slice(2);
const source = path.resolve(option("--source", "output/official-era-03/league"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-representation"));
const observations: LineupRepresentationObservation[] = [];
let bytesRead = 0;
for (const directory of fs.readdirSync(source, {withFileTypes: true}).filter(entry => entry.isDirectory() && /^season-\d+$/.test(entry.name)).sort((left, right) => left.name.localeCompare(right.name))) {
  const season = Number(directory.name.slice("season-".length)), file = path.join(source, directory.name, "decision-ledger.json");
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file); bytesRead += bytes.length;
  const ledger = JSON.parse(bytes.toString("utf8"));
  for (const record of ledger.records ?? []) {
    if (record.stage !== "lineup" || !record.context?.whiteBoxShadow) continue;
    observations.push({season, managerId: String(record.actor ?? ""), trace: record.context.whiteBoxShadow});
  }
}
const audit = auditLineupRepresentation(observations);
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-representation-audit.json"), {...audit, source, scan: {bytesRead, rawBattleLogsRead: 0}});
const markdown = [
  "# Lineup Representation Readiness",
  "",
  `- Conclusion: ${audit.conclusion}`,
  `- Traces with diagnostics: ${audit.metrics.tracesWithDiagnostics}/${audit.metrics.traces}`,
  `- Comparable/variable contrasts: ${audit.metrics.comparableContrasts}/${audit.metrics.variableContrasts}`,
  `- Managers/seasons: ${audit.metrics.managers}/${audit.metrics.seasons}`,
  `- Variable features: ${audit.metrics.variableFeatures}/${audit.metrics.features}`,
  `- Blockers: ${audit.blockers.join(", ") || "none"}`,
  "",
  "| Diagnostic | Contrasts | Non-zero | Managers | Seasons | Min delta | Max delta |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...audit.features.map(feature => `| ${feature.feature} | ${feature.contrasts} | ${feature.nonZero} | ${feature.managers} | ${feature.seasons} | ${feature.minimumDelta} | ${feature.maximumDelta} |`),
  "",
  "Readiness authorizes outcome linkage and study design only. It does not activate or weight a diagnostic.",
  "",
].join("\n");
fs.writeFileSync(path.join(out, "lineup-representation-audit.md"), markdown, "utf8");
write(path.join(out, "token-budget.json"), {
  schemaVersion: 1,
  reportBytes: Buffer.byteLength(markdown),
  estimatedReportTokens: Math.ceil(Buffer.byteLength(markdown) / 4),
  bytesRead,
  rawBattleLogsRead: 0,
});
console.log(JSON.stringify({conclusion: audit.conclusion, ...audit.metrics, blockers: audit.blockers, report: path.join(out, "lineup-representation-audit.md")}, null, 2));

function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
