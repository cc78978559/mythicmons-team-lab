import fs from "node:fs";
import path from "node:path";
import {buildFormalCanaryHandoff, verifyFormalCanaryHandoff, type FormalCanaryHandoff} from "../ai/formalCanaryControl";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status", formal = path.resolve(option("--formal-validation", "output/tooling/formal-validation-stage5-delivery-v2")), out = path.resolve(option("--out", "output/tooling/formal-canary-control")), file = path.join(out, "handoff.json");
if (command === "plan") {
  const handoff = buildFormalCanaryHandoff(read(path.join(formal, "freeze.json")), read(path.join(formal, "summary.json")), {seasons: integer("--seasons", 2), applicationRate: number("--rate", .1), maximumApplicationsPerSeason: integer("--max-applications", 12)});
  fs.mkdirSync(out, {recursive: true}); write(file, handoff); write(path.join(out, "status.json"), compact(handoff)); console.log(JSON.stringify(compact(handoff), null, 2));
} else if (command === "status") {
  const handoff = optional(file); console.log(JSON.stringify(handoff ? compact(handoff) : {available: false, status: "not-planned"}, null, 2));
} else if (command === "doctor") {
  try { const handoff = read(file) as FormalCanaryHandoff; verifyFormalCanaryHandoff(handoff); const freeze = read(path.join(formal, "freeze.json")), summary = read(path.join(formal, "summary.json")); const fresh = buildFormalCanaryHandoff(freeze, summary, {seasons: handoff.control.seasons, applicationRate: handoff.control.applicationRate, maximumApplicationsPerSeason: handoff.control.maximumApplicationsPerSeason}); if (fresh.sha256 !== handoff.sha256) throw new Error("Canary handoff is stale relative to formal validation"); console.log(JSON.stringify({available: true, healthy: true, ...compact(handoff)}, null, 2)); } catch (error) { console.log(JSON.stringify({available: fs.existsSync(file), healthy: false, issues: [{severity: "error", code: "formal-canary-handoff", message: error instanceof Error ? error.message : String(error)}]}, null, 2)); process.exitCode = 2; }
} else throw new Error("Usage: npm run formal-canary -- <plan|status|doctor> [options]");

function compact(value: FormalCanaryHandoff): Record<string, unknown> { return {available: true, status: value.status, sha256: value.sha256, domains: value.domains.map(domain => ({domainId: domain.domainId, mechanismKey: domain.mechanismKey, adapter: domain.adapter.status})), control: value.control, automaticActivationAllowed: value.automaticActivationAllowed}; }
function read(file: string): any { return JSON.parse(fs.readFileSync(file, "utf8")); }
function optional(file: string): FormalCanaryHandoff | null { try { const value = read(file); verifyFormalCanaryHandoff(value); return value; } catch { return null; } }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; }
function integer(name: string, fallback: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`); return value; }
function number(name: string, fallback: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`); return value; }
