import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type DecisionStage = "calibration" | "auction" | "draft" | "lineup" | "battle" | "waiver" | "playoff" | "review";

export interface DecisionAlternative {
  option: string;
  score?: number;
  cost?: number;
  rejectedBecause?: string[];
}

export interface DecisionRecord {
  id: string;
  sequence: number;
  stage: DecisionStage;
  actor: string;
  decision: string;
  selected: string | string[] | null;
  context: Record<string, unknown>;
  alternatives: DecisionAlternative[];
  rationale: string[];
  expectedValue?: number;
  confidence?: number;
  links: string[];
  outcome?: Record<string, unknown>;
}

export class DecisionLedger {
  private records: DecisionRecord[];

  constructor(records: readonly DecisionRecord[] = []) {
    this.records = records.map(record => ({...record, context: {...record.context}, alternatives: record.alternatives.map(option => ({...option})), rationale: [...record.rationale], links: [...record.links], outcome: record.outcome ? {...record.outcome} : undefined}));
  }

  add(input: Omit<DecisionRecord, "id" | "sequence" | "links"> & {links?: string[]}): DecisionRecord {
    const sequence = this.records.length + 1;
    const record: DecisionRecord = {...input, id: `decision-${String(sequence).padStart(5, "0")}`, sequence, links: input.links ?? []};
    this.records.push(record);
    return record;
  }

  resolve(id: string, outcome: Record<string, unknown>, links: string[] = []): void {
    const record = this.records.find(candidate => candidate.id === id);
    if (!record) throw new Error(`Unknown decision record: ${id}`);
    record.outcome = {...(record.outcome ?? {}), ...outcome};
    record.links.push(...links.filter(link => !record.links.includes(link)));
  }

  all(): readonly DecisionRecord[] {
    return this.records;
  }

  write(outputDir: string): void {
    fs.mkdirSync(outputDir, {recursive: true});
    atomicWrite(path.join(outputDir, "decision-ledger.json"), `${JSON.stringify({version: 1, records: this.records}, null, 2)}\n`);
    atomicWrite(path.join(outputDir, "decision-ledger.md"), this.toMarkdown());
  }

  private toMarkdown(): string {
    const lines = ["# 赛事决策账本", "", `共记录 ${this.records.length} 个关键决策。`, ""];
    for (const stage of ["calibration", "auction", "draft", "lineup", "battle", "waiver", "playoff", "review"] as DecisionStage[]) {
      const records = this.records.filter(record => record.stage === stage);
      if (!records.length) continue;
      lines.push(`## ${stage}`, "");
      for (const record of records) {
        lines.push(`### ${record.id} ${record.actor}：${record.decision}`, "", `- 选择：${Array.isArray(record.selected) ? record.selected.join("、") : record.selected ?? "放弃"}`);
        if (record.rationale.length) lines.push(`- 理由：${record.rationale.join("；")}`);
        if (record.alternatives.length) lines.push(`- 主要备选：${record.alternatives.slice(0, 3).map(option => `${option.option}${option.score === undefined ? "" : `(${option.score.toFixed(3)})`}`).join("、")}`);
        if (record.outcome) lines.push(`- 结果：${Object.entries(record.outcome).map(([key, value]) => `${key}=${String(value)}`).join("；")}`);
        lines.push("");
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

function atomicWrite(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, file);
}
