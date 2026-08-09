import fs from "node:fs";
import path from "node:path";
import {runBattle} from "../showdown/battle";
import {loadTeam} from "../showdown/team";
import {validateRegistryDirectory} from "../draft/registrySnapshot";
import {LEAGUE_CONFIGURATION_POLICY_VERSION, sha256} from "../showdown/evidenceEpoch";
import {acquireNamedRunLock} from "../draft/runLock";

interface BenchmarkIndex {id: string; format: string; benchmarks: Array<{id: string; team: string; archetype?: string}>}
const args = process.argv.slice(2), indexFile = path.resolve(option("--index", "benchmarks/gen9expanded/index.json")), out = path.resolve(option("--out", "output/tooling/position-value-corpus-v1"));
const seeds = integer("--seeds", 2, 1, 20), concurrency = integer("--concurrency", 4, 1, 16), maxTurns = integer("--max-turns", 80, 10, 500), registry = path.resolve(option("--registry", "data/draft"));

async function main(): Promise<void> {
  const started = Date.now(); fs.mkdirSync(out, {recursive: true}); const lock = acquireNamedRunLock(out, ".position-corpus.lock", {indexFile, seeds, concurrency});
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as BenchmarkIndex, base = path.dirname(indexFile), registrySnapshot = validateRegistryDirectory(registry);
    const teams = index.benchmarks.map(entry => ({...entry, packed: loadTeam(path.join(base, entry.team)).packed})), jobs: Array<{id: string; left: number; right: number; seed: number; orientation: number; directory: string}> = [];
    for (let left = 0; left < teams.length; left += 1) for (let right = left + 1; right < teams.length; right += 1) for (let seed = 1; seed <= seeds; seed += 1) for (let orientation = 0; orientation < 2; orientation += 1) { const id = `${teams[left].id}--${teams[right].id}--s${seed}--o${orientation + 1}`; jobs.push({id, left, right, seed, orientation, directory: path.join(out, "battles", `${teams[left].id}--${teams[right].id}`, `seed-${String(seed).padStart(2, "0")}`, orientation ? "right-p1" : "left-p1")}); }
    const results: Array<{id: string; status: "generated" | "reused"; winner?: string | null; turns?: number}> = [], failures: Array<{id: string; message: string}> = []; let cursor = 0;
    async function worker(): Promise<void> { while (cursor < jobs.length) { const job = jobs[cursor++], game = path.join(job.directory, "game-0001"), existing = ["replay-input.json", "ai-decisions.json", "end.json"].every(file => fs.existsSync(path.join(game, file)));
        if (existing) { results.push({id: job.id, status: "reused"}); continue; }
        try { const first = teams[job.orientation ? job.right : job.left], second = teams[job.orientation ? job.left : job.right], profile = profiles[(job.left + job.right + job.seed) % profiles.length], opponentProfile = profiles[(job.left * 3 + job.right + job.seed + 1) % profiles.length];
          const battle = await runBattle({format: index.format, teamA: first.packed, teamB: second.packed, seed: `position-value:${index.id}:${job.id}`, gameIndex: 0, outDir: job.directory, maxTurns, idleTimeoutMs: 10000, wallClockTimeoutMs: 60000, ai: "search", openTeamSheets: true, traceAiDecisions: true, aiProfiles: {p1: {...profile, id: `${profile.id}-p1`}, p2: {...opponentProfile, id: `${opponentProfile.id}-p2`}}, evidenceContext: {registryHash: registrySnapshot.hash, configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION}}); results.push({id: job.id, status: "generated", winner: battle.winner, turns: battle.turns});
        } catch (error) { failures.push({id: job.id, message: error instanceof Error ? error.message : String(error)}); }
      } }
    await Promise.all(Array.from({length: concurrency}, () => worker()));
    const manifestCore = {schemaVersion: 1, corpusVersion: "position-value-corpus-v1", index: {file: indexFile, id: index.id, format: index.format, teams: teams.map(team => ({id: team.id, archetype: team.archetype ?? null, teamSha256: sha256(team.packed)}))}, registry: {source: registry, hash: registrySnapshot.hash}, configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION, settings: {seeds, orientations: 2, maxTurns, jobs: jobs.length}, results: {complete: results.length, generated: results.filter(result => result.status === "generated").length, reused: results.filter(result => result.status === "reused").length, failures: failures.length}, elapsedMs: Date.now() - started};
    const manifest = {...manifestCore, sha256: sha256(manifestCore)}; atomic(path.join(out, "corpus-manifest.json"), manifest); atomic(path.join(out, "failures.json"), {schemaVersion: 1, failures}); console.log(JSON.stringify(manifest, null, 2)); if (failures.length) process.exitCode = 2;
  } finally { lock.release(); }
}

const profiles = [
  {id: "neutral"},
  {id: "pressure", aggression: .5, setupBias: .25, expectedWeight: .7, downsideWeight: .2, worstWeight: .1},
  {id: "risk-aware", aggression: -.2, recoveryBias: .35, expectedWeight: .4, downsideWeight: .35, worstWeight: .25},
  {id: "mobility", pivotBias: .5, switchBias: .25, statusBias: .15},
] as const;
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integer(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
main().catch(error => { console.error(error); process.exitCode = 1; });
