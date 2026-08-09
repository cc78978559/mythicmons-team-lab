import fs from "node:fs";
import path from "node:path";

type Metrics = {
  cases: number;
  managers: number;
  better: number;
  neutral: number;
  worse: number;
  games: number;
  actionDivergences: number;
  outcomeChanges: number;
};

type StudyRow = Metrics & {
  hypothesisId: string;
  conclusion: string;
  causalScope: string;
};

const args = process.argv.slice(2);
const runFile = path.resolve(required("--run"));
const out = path.resolve(required("--out"));
const reviewFile = option("--review", "");
const run = read<any>(runFile);

if (run.schemaVersion !== 1 || run.activationStatus !== "shadow-only" || run.status !== "complete") {
  throw new Error("Portfolio run is not a completed shadow-only artifact");
}

const rows: StudyRow[] = (run.items ?? []).map((item: any) => {
  const summaryFile = path.join(path.resolve(String(item.study)), "causal-summary.json");
  if (!fs.existsSync(summaryFile)) throw new Error(`Missing causal summary: ${summaryFile}`);
  const summary = read<any>(summaryFile);
  if (summary.activationStatus !== "shadow-only" || summary.hypothesisId !== item.hypothesisId || Number(summary.failed) !== 0) {
    throw new Error(`Invalid causal summary: ${summaryFile}`);
  }
  return {
    hypothesisId: String(summary.hypothesisId),
    conclusion: String(summary.conclusion),
    causalScope: String(summary.causalScope),
    ...metrics(summary.metrics),
  };
});

const totals = rows.reduce<Metrics>((sum, row) => add(sum, row), emptyMetrics());
const review = reviewFile ? read<any>(path.resolve(reviewFile)) : null;
if (review && (review.activationStatus !== "shadow-only" || Number(review.round) < 1)) throw new Error("Invalid manager research review");
const conclusion = totals.better === 0 && totals.worse > 0
  ? "no-boundary-rescued-deployment"
  : totals.better > totals.worse
    ? "candidate-boundary-benefit-needs-independent-replication"
    : "no-clear-portfolio-benefit";
const result = {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  authority: "research-only-no-activation-authority",
  conclusion,
  recommendation: conclusion === "no-boundary-rescued-deployment" ? "retain-parent-retirement" : "do-not-activate-without-independent-replication",
  totals: {...totals, studies: rows.length},
  managerLearning: review ? {
    round: Number(review.round),
    executed: Number(review.executed),
    unexecuted: Number(review.unexecuted),
    firstChoiceExecuted: Number(review.firstChoiceExecuted),
    meanInformationReward: Number(review.informationReward?.mean ?? 0),
  } : null,
  studies: rows,
};

fs.mkdirSync(out, {recursive: true});
write(path.join(out, "portfolio-summary.json"), result);
const report = markdown(result);
fs.writeFileSync(path.join(out, "portfolio-summary.md"), report, "utf8");
const tokenEstimate = Math.ceil(report.length / 4);
write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportCharacters: report.length, estimatedTokens: tokenEstimate, detailedStudyFilesRead: rows.length});
console.log(JSON.stringify({conclusion, totals: result.totals, managerLearning: result.managerLearning, estimatedReportTokens: tokenEstimate, out}, null, 2));

function metrics(value: any): Metrics {
  const keys: (keyof Metrics)[] = ["cases", "managers", "better", "neutral", "worse", "games", "actionDivergences", "outcomeChanges"];
  const output = emptyMetrics();
  for (const key of keys) {
    const numeric = Number(value?.[key] ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`Invalid metric ${key}`);
    output[key] = numeric;
  }
  return output;
}
function emptyMetrics(): Metrics { return {cases: 0, managers: 0, better: 0, neutral: 0, worse: 0, games: 0, actionDivergences: 0, outcomeChanges: 0}; }
function add(left: Metrics, right: Metrics): Metrics { return {cases: left.cases + right.cases, managers: left.managers + right.managers, better: left.better + right.better, neutral: left.neutral + right.neutral, worse: left.worse + right.worse, games: left.games + right.games, actionDivergences: left.actionDivergences + right.actionDivergences, outcomeChanges: left.outcomeChanges + right.outcomeChanges}; }
function markdown(value: typeof result): string {
  const learning = value.managerLearning ? `\n经理学习：第 ${value.managerLearning.round} 轮，${value.managerLearning.firstChoiceExecuted} 项第一选择完成，${value.managerLearning.unexecuted} 位经理未被强制分配实验，平均信息奖励 ${value.managerLearning.meanInformationReward.toFixed(3)}。\n` : "";
  return `# Lineup Deployment Portfolio Summary\n\n结论：${value.conclusion}\n\n建议：${value.recommendation}\n\n共 ${value.totals.studies} 条边界假设、${value.totals.cases} 个经理因果案例、${value.totals.games} 场对照比赛。直接结果为 ${value.totals.better} 改善 / ${value.totals.neutral} 中性 / ${value.totals.worse} 恶化；发生 ${value.totals.actionDivergences} 次行动分歧和 ${value.totals.outcomeChanges} 次赛果变化。${learning}\n该工件仅用于研究，不提供激活权限。\n`;
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
