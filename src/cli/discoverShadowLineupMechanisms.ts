import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {discoverLineupMechanisms, lineupMechanismDiscoveryMarkdown, lineupMechanismFeatureValues, type LineupMechanismSample} from "../ai/whiteBox/lineupMechanismDiscovery";

const args = process.argv.slice(2);
const pilot = path.resolve(option("--pilot", "output/tooling/shadow-lineup-pilot"));
const out = path.resolve(option("--out", path.join(pilot, "mechanism-discovery")));
const manifest = read<any>(path.join(pilot, "pilot-manifest.json"));
const completed = (manifest.items ?? []).filter((item: any) => item.status === "complete");
if (completed.length !== (manifest.items ?? []).length) throw new Error(`Mechanism discovery requires a complete pilot: ${completed.length}/${manifest.items?.length ?? 0}`);
const samples: LineupMechanismSample[] = [], gateRejections: Record<string, number> = {};
let gateRecommended = 0;
for (const item of completed) {
  const archive = path.resolve(String(item.output ?? ""));
  if (!archive.startsWith(`${pilot}${path.sep}`)) throw new Error(`Unsafe pilot capsule: ${archive}`);
  const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8"));
  const experiment = capsule.interventionRecord?.context?.whiteBoxLineupExperiment, trace = experiment?.trace;
  if (!trace || String(trace.decisionId) !== String(item.decisionId)) throw new Error(`Missing exact intervention trace: ${item.id}`);
  const incumbent = trace.candidates?.find((candidate: any) => String(candidate.id) === String(trace.comparison?.incumbent));
  const selected = trace.candidates?.find((candidate: any) => String(candidate.id) === String(trace.comparison?.shadow));
  if (!incumbent || !selected) throw new Error(`Missing exact treatment candidates: ${item.id}`);
  const before = lineupMechanismFeatureValues(incumbent), after = lineupMechanismFeatureValues(selected), featureDeltas: Record<string, number> = {};
  for (const feature of new Set([...before.keys(), ...after.keys()])) featureDeltas[feature] = round((after.get(feature) ?? 0) - (before.get(feature) ?? 0));
  const direction = String(capsule.summary?.localOutcome?.direction ?? "");
  if (direction !== "better" && direction !== "neutral" && direction !== "worse") throw new Error(`Invalid outcome direction: ${item.id}`);
  samples.push({id: String(item.id), managerId: String(item.actor), season: Number(item.season), direction, featureDeltas});
  if (experiment.gate?.recommended) gateRecommended++;
  for (const reason of experiment.gate?.hardRejections ?? []) gateRejections[String(reason)] = (gateRejections[String(reason)] ?? 0) + 1;
}
const discovery = discoverLineupMechanisms(samples);
const result = {...discovery, assistGate: {recommended: gateRecommended, rejected: samples.length - gateRecommended, hardRejections: gateRejections}};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-mechanism-discovery.json"), result);
fs.writeFileSync(path.join(out, "lineup-mechanism-discovery.md"), `${lineupMechanismDiscoveryMarkdown(discovery)}\n## Historical assist gate\n\n- Recommended: ${gateRecommended}/${samples.length}\n- Hard rejections: ${JSON.stringify(gateRejections)}\n`, "utf8");
write(path.join(out, "token-budget.json"), {
  schemaVersion: 1,
  summaryBytes: fs.statSync(path.join(out, "lineup-mechanism-discovery.json")).size,
  estimatedTokens: Math.ceil(fs.statSync(path.join(out, "lineup-mechanism-discovery.json")).size / 4),
  rawBattleLogsRead: 0,
});
console.log(JSON.stringify({
  conclusion: discovery.conclusion,
  samples: discovery.metrics.samples,
  decisive: discovery.metrics.decisive,
  eligibleFeatures: discovery.metrics.eligibleFeatures,
  inactiveFeatures: discovery.metrics.inactiveFeatures,
  gateRecommended,
  report: path.join(out, "lineup-mechanism-discovery.md"),
}, null, 2));

function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
