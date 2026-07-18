import crypto from "node:crypto";
import fs from "node:fs";
import {evaluateStrategyProgram, type ProgramEntrypoint, type StrategyProgram} from "./strategyProgram";

export interface ProgramOpportunityEntry {observations: number; samples: Array<{hash: string; inputs: Record<string, number>}>}
export interface ManagerProgramOpportunities {managerId: string; entrypoints: Partial<Record<ProgramEntrypoint, ProgramOpportunityEntry>>}
export interface ProgramOpportunitySnapshot {schemaVersion: 1; season: number; sampleLimit: number; managers: ManagerProgramOpportunities[]}
export interface ProgramOpportunityDistance {distance: number; choicePotential: number; observedEntrypoints: number; observations: number; byEntrypoint: Partial<Record<ProgramEntrypoint, {distance: number; choicePotential: number; observations: number; samples: number}>>}

const ENTRYPOINTS: ProgramEntrypoint[] = ["acquire", "configure", "lineup", "battle", "learn"];

export class StrategyProgramOpportunityCollector {
  private readonly managers = new Map<string, ManagerProgramOpportunities>();
  constructor(readonly sampleLimit = 24, snapshot?: ProgramOpportunitySnapshot) {
    if (!Number.isInteger(sampleLimit) || sampleLimit < 4 || sampleLimit > 128) throw new Error("Program opportunity sample limit must be 4..128");
    for (const manager of snapshot?.managers ?? []) this.managers.set(manager.managerId, structuredClone(manager));
  }
  record(managerId: string, entrypoint: ProgramEntrypoint, inputs: Record<string, number>): void {
    if (!managerId) return;
    const normalized = Object.fromEntries(Object.entries(inputs).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, round(Number.isFinite(value) ? value : 0)]));
    const hash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const manager = this.managers.get(managerId) ?? {managerId, entrypoints: {}};
    const entry = manager.entrypoints[entrypoint] ?? {observations: 0, samples: []};
    entry.observations += 1;
    if (!entry.samples.some(sample => sample.hash === hash)) {
      entry.samples.push({hash, inputs: normalized});
      entry.samples.sort((left, right) => left.hash.localeCompare(right.hash));
      if (entry.samples.length > this.sampleLimit) entry.samples.length = this.sampleLimit;
    }
    manager.entrypoints[entrypoint] = entry;
    this.managers.set(managerId, manager);
  }
  evaluate(managerId: string, program: StrategyProgram | undefined, entrypoint: ProgramEntrypoint, inputs: Record<string, number>): number {
    this.record(managerId, entrypoint, inputs);
    return evaluateStrategyProgram(program, entrypoint, inputs).value;
  }
  snapshot(season: number): ProgramOpportunitySnapshot { return {schemaVersion: 1, season, sampleLimit: this.sampleLimit, managers: [...this.managers.values()].sort((left, right) => left.managerId.localeCompare(right.managerId)).map(value => structuredClone(value))}; }
  write(file: string, season: number): void { fs.writeFileSync(file, `${JSON.stringify(this.snapshot(season), null, 2)}\n`, "utf8"); }
  static read(file: string): StrategyProgramOpportunityCollector { const value = JSON.parse(fs.readFileSync(file, "utf8")) as ProgramOpportunitySnapshot; if (value.schemaVersion !== 1) throw new Error("Unsupported program opportunity snapshot"); return new StrategyProgramOpportunityCollector(value.sampleLimit, value); }
}

export function strategyProgramOpportunityDistance(parent: StrategyProgram | undefined, candidate: StrategyProgram | undefined, opportunities: ManagerProgramOpportunities | undefined): ProgramOpportunityDistance {
  const byEntrypoint: ProgramOpportunityDistance["byEntrypoint"] = {};
  let weightedDistance = 0, weightedPotential = 0, totalWeight = 0, observations = 0, observedEntrypoints = 0;
  for (const entrypoint of ENTRYPOINTS) {
    const entry = opportunities?.entrypoints[entrypoint];
    if (!entry?.samples.length || entry.observations <= 0) continue;
    const parentValues = entry.samples.map(sample => evaluateStrategyProgram(parent, entrypoint, sample.inputs).value), candidateValues = entry.samples.map(sample => evaluateStrategyProgram(candidate, entrypoint, sample.inputs).value);
    const deltas = candidateValues.map((value, index) => value - parentValues[index]);
    const distance = mean(deltas.map(value => Math.abs(value) / 8));
    const choicePotential = entrypoint === "battle" ? distance : entrypoint === "learn" ? valueRange(deltas) / 8 : rankingPotential(entrypoint, entry.samples.map(sample => sample.inputs), parentValues, candidateValues);
    const weight = Math.log1p(entry.observations);
    byEntrypoint[entrypoint] = {distance: round(distance), choicePotential: round(choicePotential), observations: entry.observations, samples: entry.samples.length};
    weightedDistance += distance * weight; weightedPotential += choicePotential * weight; totalWeight += weight; observations += entry.observations; observedEntrypoints += 1;
  }
  return {distance: round(totalWeight ? weightedDistance / totalWeight : 0), choicePotential: round(totalWeight ? weightedPotential / totalWeight : 0), observedEntrypoints, observations, byEntrypoint};
}

function rankingPotential(entrypoint: "acquire" | "configure" | "lineup", inputs: Array<Record<string, number>>, parentValues: number[], candidateValues: number[]): number {
  const baseScale = entrypoint === "acquire" ? 1 : entrypoint === "configure" ? 150 : 10, programScale = entrypoint === "acquire" ? .15 : entrypoint === "configure" ? 8 : .2;
  const parentScores = inputs.map((input, index) => (input.baseline ?? 0) * baseScale + parentValues[index] * programScale), candidateScores = inputs.map((input, index) => (input.baseline ?? 0) * baseScale + candidateValues[index] * programScale);
  let comparable = 0, changed = 0;
  for (let left = 0; left < inputs.length; left += 1) for (let right = left + 1; right < inputs.length; right += 1) {
    const before = Math.sign(parentScores[left] - parentScores[right]), after = Math.sign(candidateScores[left] - candidateScores[right]);
    if (before === 0 && after === 0) continue;
    comparable += 1;
    if (before !== after) changed += before === 0 || after === 0 ? .5 : 1;
  }
  return comparable ? changed / comparable : 0;
}
function valueRange(values: number[]): number { return values.length ? Math.max(...values) - Math.min(...values) : 0; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
