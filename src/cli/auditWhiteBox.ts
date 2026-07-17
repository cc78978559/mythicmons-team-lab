import fs from "node:fs";
import path from "node:path";
import {auditWhiteBoxOutput, whiteBoxAuditMarkdown} from "../ai/whiteBox/audit";

const args = process.argv.slice(2);
const out = path.resolve(option("--out", "output/draft-league-v12"));
const summary = auditWhiteBoxOutput(out);
const jsonPath = path.resolve(option("--json", path.join(out, "whitebox-audit-summary.json")));
const reportPath = path.resolve(option("--report", path.join(out, "whitebox-audit-report.md")));
fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
fs.mkdirSync(path.dirname(reportPath), {recursive: true});
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(reportPath, whiteBoxAuditMarkdown(summary), "utf8");
console.log(JSON.stringify({promotion: summary.promotion, coverage: summary.coverage, fatal: summary.fatalCount, warnings: summary.warningCount, comparisons: summary.metrics.comparisons, agreementRate: summary.metrics.agreementRate, auditBytes: summary.metrics.auditBytes, summary: jsonPath, report: reportPath}, null, 2));
if (summary.fatalCount) process.exitCode = 2;
else if (args.includes("--strict-warnings") && summary.warningCount) process.exitCode = 3;

function option(name: string, fallback: string): string {const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
