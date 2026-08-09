import path from "node:path";
import {buildDecisionDossiers, decisionDossierStatus, doctorDecisionDossiers, listManagerDossiers, showDecisionDossier} from "../draft/decisionDossierStore";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const league = path.resolve(option("--league", "output/official-era-03/league"));
const out = path.resolve(option("--out", "output/tooling/decision-dossiers"));

if (command === "build") print(buildDecisionDossiers({leagueDirectory: league, outputDirectory: out, firstSeason: optionalNumber("--first-season"), lastSeason: optionalNumber("--last-season")}));
else if (command === "status") print(decisionDossierStatus(out));
else if (command === "doctor") { const result = doctorDecisionDossiers(out, {verifySources: args.includes("--verify-sources")}); print(result); if (result.healthy === false) process.exitCode = 2; }
else if (command === "show") { const id = required("--id"); const result = showDecisionDossier(out, id, args.includes("--hydrate")); if (!result) { console.error(`Unknown dossier: ${id}`); process.exitCode = 2; } else print(result); }
else if (command === "manager") print(listManagerDossiers(out, required("--manager"), {season: optionalNumber("--season"), limit: optionalNumber("--limit")}));
else throw new Error("Usage: npm run decision-dossiers -- <build|status|doctor|show|manager> [options]");

function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function optionalNumber(name: string): number | undefined { const value = option(name, ""); if (!value) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`); return parsed; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
