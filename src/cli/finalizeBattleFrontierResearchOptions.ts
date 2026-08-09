import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const optionsFile = path.resolve(required("--options"));
const auditFile = path.resolve(required("--audit"));
const out = path.resolve(required("--out"));
const options = read<any>(optionsFile);
const audit = read<any>(auditFile);

if (options.schemaVersion !== 1 || options.activationStatus !== "shadow-only"
  || options.evidenceStatus !== "observational-candidate-frontier" || !Array.isArray(options.hypotheses)) {
  throw new Error("Invalid battle frontier research options");
}
if (audit.schemaVersion !== 1 || audit.activationStatus !== "shadow-only"
  || audit.evidenceStatus !== "prospective-independent-holdout" || audit.activationEligible !== false) {
  throw new Error("Invalid battle frontier holdout audit");
}
const retirement = audit.conclusion === "reject-hypothesis" && audit.disposition === "retire-mechanism";
const inconclusive = audit.conclusion === "blocked-or-inconclusive" && audit.disposition === "retain-shadow";
if (!retirement && !inconclusive) throw new Error("Battle frontier holdout does not authorize an options disposition");

const status = retirement ? "retired" : "holdout-inconclusive";
const evidence = path.relative(process.cwd(), auditFile).replaceAll("\\", "/");
const evidenceSha256 = shaFile(auditFile);
let changed = 0;
const hypotheses = options.hypotheses.map((value: any) => {
  if (value.id !== audit.mechanismId) return value;
  changed += 1;
  return {...value, researchEligible: false, causalConclusion: audit.conclusion,
    disposition: {status, evidence, sha256: evidenceSha256}};
});
if (changed !== 1) throw new Error(`Expected one disposed mechanism, found ${changed}`);
const disposition = {mechanismId: audit.mechanismId, status, conclusion: audit.conclusion, evidenceSha256};
const dispositions = [...(options.dispositions ?? []).filter((value: any) => value.mechanismId !== audit.mechanismId), disposition];
const result = {...options, hypotheses, dispositions};

fs.mkdirSync(out, {recursive: true});
write(path.join(out, "research-options.json"), result);
write(path.join(out, "summary.json"), {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  disposed: [disposition],
  remainingResearchEligible: hypotheses.filter((value: any) => value.researchEligible === true && !value.causalConclusion).length,
  sha256: evidenceSha256,
});
console.log(JSON.stringify({disposed: [disposition], remainingResearchEligible: hypotheses.filter((value: any) => value.researchEligible === true && !value.causalConclusion).length, out}, null, 2));

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function shaFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function write(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
function required(name: string): string {
  const value = option(name, "");
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? fallback) : fallback;
}
