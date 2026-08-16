import os from "node:os";
import path from "node:path";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import type {BattleInput, BattleResult} from "../showdown/battle";

interface WorkerRequest {id: number; input: BattleInput}
interface WorkerResponse {id: number; ok: boolean; result?: BattleResult; error?: string}
interface WorkerState {child: ChildProcessWithoutNullStreams; buffer: string; stderr: string; active: number | null; closed: boolean}

export type BattleWorkerOutcome = {ok: true; result: BattleResult} | {ok: false; error: string};
export interface BattleWorkerPoolOptions {onComplete?: (outcome: BattleWorkerOutcome, inputIndex: number) => void}

export function recommendedBattleWorkers(games: number): number {
  return Math.max(1, Math.min(games, 32, os.availableParallelism()));
}

export async function runBattleWorkerPool(inputs: readonly BattleInput[], workers: number): Promise<BattleResult[]> {
  const outcomes = await runBattleWorkerPoolSettled(inputs, workers);
  const failed = outcomes.find((outcome): outcome is Extract<BattleWorkerOutcome, {ok: false}> => !outcome.ok);
  if (failed) throw new Error(failed.error);
  return outcomes.map(outcome => (outcome as Extract<BattleWorkerOutcome, {ok: true}>).result);
}

export async function runBattleWorkerPoolSettled(inputs: readonly BattleInput[], workers: number, options: BattleWorkerPoolOptions = {}): Promise<BattleWorkerOutcome[]> {
  if (!inputs.length) return [];
  if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error("Battle worker count must be 1..64");
  const workerCount = Math.min(workers, inputs.length), queue = inputs.map((input, id): WorkerRequest => ({id, input})), outcomes: Array<BattleWorkerOutcome | undefined> = Array(inputs.length), states: WorkerState[] = [];
  let cursor = 0, completed = 0, settled = false, closing = false;
  return new Promise<BattleWorkerOutcome[]>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return; settled = true;
      for (const state of states) if (!state.closed) state.child.kill();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const finish = () => {
      if (settled || closing || completed !== inputs.length) return; closing = true;
      for (const state of states) state.child.stdin.end(`${JSON.stringify({type: "close"})}\n`);
    };
    const dispatch = (state: WorkerState) => {
      if (settled || state.active !== null) return;
      const job = queue[cursor++]; if (!job) { finish(); return; }
      state.active = job.id;
      state.child.stdin.write(`${JSON.stringify({type: "battle", ...job})}\n`, error => { if (error) fail(error); });
    };
    for (let index = 0; index < workerCount; index += 1) {
      const child = spawn(process.execPath, [require.resolve("tsx/cli"), path.resolve(__dirname, "../cli/battleWorker.ts")], {cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], env: {...process.env, MYTHICMONS_BATTLE_WORKER: "1"}}), state: WorkerState = {child, buffer: "", stderr: "", active: null, closed: false}; states.push(state);
      child.stderr.on("data", chunk => { state.stderr = `${state.stderr}${String(chunk)}`.slice(-16384); });
      child.stdout.on("data", chunk => {
        state.buffer += String(chunk);
        for (;;) {
          const newline = state.buffer.indexOf("\n"); if (newline < 0) break;
          const line = state.buffer.slice(0, newline).trim(); state.buffer = state.buffer.slice(newline + 1); if (!line) continue;
          let response: WorkerResponse; try { response = JSON.parse(line) as WorkerResponse; } catch { fail(new Error(`Battle worker emitted invalid output: ${line.slice(0, 500)}`)); return; }
          if (state.active === null || response.id !== state.active) { fail(new Error(`Battle worker response mismatch: expected ${state.active}, received ${response.id}`)); return; }
          const outcome: BattleWorkerOutcome = response.ok && response.result ? {ok: true, result: response.result} : {ok: false, error: `Battle worker ${index + 1} failed job ${response.id}: ${response.error ?? "unknown error"}`};
          outcomes[response.id] = outcome; state.active = null; completed += 1;
          try { options.onComplete?.(outcome, response.id); } catch (error) { fail(error); return; }
          dispatch(state);
        }
      });
      child.on("error", fail);
      child.on("exit", (code, signal) => {
        state.closed = true;
        if (!settled && !closing) fail(new Error(`Battle worker ${index + 1} exited early (${code ?? signal ?? "unknown"}): ${state.stderr || "no stderr"}`));
        else if (!settled && closing && states.every(value => value.closed)) { settled = true; resolve(outcomes as BattleWorkerOutcome[]); }
      });
      dispatch(state);
    }
  });
}
