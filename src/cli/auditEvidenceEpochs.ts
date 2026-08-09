import path from "node:path";
import {auditEvidenceEpochs} from "../draft/evidenceEpochAudit";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: npm run audit:evidence-epochs -- --root DIR [--out DIR] [--verify-events] [--require-current] [--require-formal-context]");
  process.exit(0);
}
const root = path.resolve(option("--root", "output/tooling")), out = path.resolve(option("--out", path.join(root, "evidence-epoch-audit")));
const {summary} = auditEvidenceEpochs(root, out, {verifyEvents: args.includes("--verify-events")});
console.log(JSON.stringify(summary, null, 2));
if ((args.includes("--require-current") && !summary.requireCurrentPassed) || (args.includes("--require-formal-context") && !summary.requireFormalContextPassed) || summary.counts.invalid > 0) process.exitCode = 2;

function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
