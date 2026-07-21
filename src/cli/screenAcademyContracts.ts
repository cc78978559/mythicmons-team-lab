import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {AcademyContractSettlement} from "../draft/academyContracts";
import {reconstructAcademyContractSettlement, screenAcademyContractConcessions} from "../ai/whiteBox/academyContractCounterfactual";

interface EntrantsArtifact {schemaVersion: number; cycle: number; contracts: AcademyContractSettlement}
const args = process.argv.slice(2);
const source = path.resolve(required("--source"));
const entrantsPath = fs.statSync(source).isDirectory() ? path.join(source, "entrants.json") : source;
const out = path.resolve(option("--out", path.join(path.dirname(entrantsPath), "academy-contract-screen")));
const bytes = fs.readFileSync(entrantsPath), artifact = JSON.parse(bytes.toString("utf8")) as EntrantsArtifact;
const reconstructed = reconstructAcademyContractSettlement(artifact.contracts);
const cases = screenAcademyContractConcessions(artifact.contracts);
const result = {
  schemaVersion: 1, hypothesis: "academy-manager-accepts-offer-v1", source: {entrantsPath, schemaVersion: artifact.schemaVersion, cycle: artifact.cycle, sha256: crypto.createHash("sha256").update(bytes).digest("hex")},
  validation: {sourceReconstructed: true, contractCount: reconstructed.contracts.length, balanceCount: Object.keys(reconstructed.balances).length},
  scope: "contract-ledger-only", activationStatus: "shadow-only", cases,
};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "academy-contract-screens.json"), result);
fs.writeFileSync(path.join(out, "academy-contract-screens.md"), report(result), "utf8");
console.log(JSON.stringify({out, cycle: artifact.cycle, contracts: reconstructed.contracts.length, cases: cases.length, sourceReconstructed: true}, null, 2));

function report(value: typeof result): string {
  return `# Academy contract counterfactual screen\n\nCycle ${value.source.cycle}; ${value.validation.contractCount} contracts reconstructed exactly; ${value.cases.length} concession cases. These are shadow-only contract-ledger effects, not competitive promotion evidence.\n\n| Child | Incumbent | Candidate salary | Affected contracts | Payroll delta | Arrears delta | Academy balance delta |\n|---|---|---:|---:|---:|---:|---:|\n${value.cases.map(item => `| ${item.childName} | ${item.incumbentStatus} | ${item.candidateSalary.toFixed(2)} | ${item.affectedChildIds.length} | ${item.payrollDelta.toFixed(2)} | ${item.arrearsDelta.toFixed(2)} | ${item.academyBalanceDelta.toFixed(2)} |`).join("\n")}\n`;
}
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, "").trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
