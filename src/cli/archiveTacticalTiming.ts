import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {buildTacticalTimingArchive, tacticalTimingSummary} from "../ai/whiteBox/tacticalTimingArchive";

const args = process.argv.slice(2), source = path.resolve(required("--source")), out = path.resolve(option("--out", path.join(process.cwd(), "output", "tooling", "tactical-timing")));
if (!fs.existsSync(source)) throw new Error(`Source does not exist: ${source}`);
fs.mkdirSync(out, {recursive: true});
const archive = buildTacticalTimingArchive(source), summary = tacticalTimingSummary(archive);
atomic(path.join(out, "tactical-timing-v1.json.gz"), zlib.gzipSync(Buffer.from(`${JSON.stringify(archive)}\n`), {level: 9}));
atomic(path.join(out, "summary.json"), Buffer.from(`${JSON.stringify(summary, null, 2)}\n`));
atomic(path.join(out, "summary.md"), Buffer.from(report(summary)));
console.log(JSON.stringify({...summary, output: out}, null, 2));

function report(value: any): string { return `# Tactical timing archive v1\n\n- Games: ${value.coverage.games}\n- Decisions: ${value.coverage.decisions}\n- Managers: ${value.coverage.managers}\n- Seasons: ${value.coverage.seasons.join(", ")}\n- Full decision traces: ${value.coverage.fullTraceGames} games / ${value.coverage.fullTraceDecisions} decisions\n- Compact all-decision evidence: ${value.coverage.compactAllDecisionGames} games / ${value.coverage.compactAllDecisions} decisions\n- Legacy key-decision evidence: ${value.coverage.compactKeyDecisionGames} games / ${value.coverage.compactKeyDecisions} decisions\n- Games without decision evidence: ${value.coverage.unavailableGames}\n- Unmatched decisions: ${value.coverage.unmatchedDecisions}\n- Choice mix: ${Object.entries(value.choices).map(([key, count]) => `${key}=${count}`).join(", ")}\n- Margin bases: ${Object.entries(value.marginBasis).map(([key, count]) => `${key}=${count}`).join(", ")}\n- Style-changed rational winners: ${value.styleChanges}\n- Close score decisions: ${value.closeScoreDecisions}\n- Readiness: ${value.readiness.currentUse}\n- Population all-decision frame: ${value.readiness.populationFrameAvailable}\n- Managers with all-decision evidence: ${value.readiness.managersWithAllDecisionEvidence}\n- Managers with both outcomes: ${value.readiness.managersWithBothOutcomes}\n- Blockers: ${value.readiness.blockers.join(", ") || "none"}\n\nLegacy compact summaries are a preselected key-decision sample and must not be treated as an all-decision sample. Outcomes are retained for retrospective study only and are activation-ineligible as decision inputs.\n`; }
function atomic(file: string, bytes: Buffer): void { const temporary = `${file}.tmp-${process.pid}`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
