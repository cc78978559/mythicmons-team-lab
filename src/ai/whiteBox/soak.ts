export interface WhiteBoxSoakRun {
  seed: string;
  repeat: number;
  output: string;
  durationMs: number;
  outcomeDigest: string;
  auditDigest: string;
  outputBytes: number;
  auditBytes: number;
  coverage: number;
  comparisons: number;
  agreements: number;
  fatalCount: number;
  warningCount: number;
  auditPromotion: "blocked" | "needs-review" | "shadow-stable";
}

export interface WhiteBoxSoakIssue {severity: "fatal" | "warning"; code: string; message: string; seed?: string; repeat?: number}

export interface WhiteBoxSoakSummary {
  schemaVersion: 1;
  runs: WhiteBoxSoakRun[];
  issues: WhiteBoxSoakIssue[];
  fatalCount: number;
  warningCount: number;
  promotion: "blocked" | "needs-review" | "soak-stable";
  metrics: {
    seeds: number;
    runs: number;
    deterministicSeeds: number;
    minimumCoverage: number;
    comparisons: number;
    agreements: number;
    auditWarnings: number;
    agreementRate: number;
    averageDurationMs: number;
    maximumDurationMs: number;
    auditBytes: number;
    outputBytes: number;
    auditRatio: number;
  };
}

export function evaluateWhiteBoxSoak(runs: readonly WhiteBoxSoakRun[], maximumAuditRatio = .25): WhiteBoxSoakSummary {
  if (!runs.length) throw new Error("White-box soak requires at least one run");
  if (!Number.isFinite(maximumAuditRatio) || maximumAuditRatio <= 0 || maximumAuditRatio > 1) throw new Error("maximumAuditRatio must be within 0..1");
  const issues: WhiteBoxSoakIssue[] = [];
  for (const run of runs) {
    if (run.fatalCount || run.auditPromotion === "blocked") issues.push({severity: "fatal", code: "run-audit-blocked", message: `${run.fatalCount} fatal audit issues`, seed: run.seed, repeat: run.repeat});
    if (run.coverage < .98) issues.push({severity: "fatal", code: "coverage-below-gate", message: `${percent(run.coverage)} < 98%`, seed: run.seed, repeat: run.repeat});
    const agreement = run.comparisons ? run.agreements / run.comparisons : 1;
    if (agreement < .98) issues.push({severity: "warning", code: "agreement-below-gate", message: `${percent(agreement)} < 98%`, seed: run.seed, repeat: run.repeat});
  }
  const groups = new Map<string, WhiteBoxSoakRun[]>();
  for (const run of runs) groups.set(run.seed, [...(groups.get(run.seed) ?? []), run]);
  let deterministicSeeds = 0;
  for (const [seed, group] of groups) {
    if (group.length < 2) {issues.push({severity: "warning", code: "insufficient-repeats", message: "Seed has fewer than two repeats", seed});continue;}
    const outcomeDigests = new Set(group.map(run => run.outcomeDigest));
    const auditDigests = new Set(group.map(run => run.auditDigest));
    if (outcomeDigests.size > 1) issues.push({severity: "fatal", code: "fixed-seed-drift", message: `${outcomeDigests.size} distinct outcome digests`, seed});
    if (auditDigests.size > 1) issues.push({severity: "fatal", code: "fixed-seed-audit-drift", message: `${auditDigests.size} distinct audit digests`, seed});
    if (outcomeDigests.size === 1 && auditDigests.size === 1) deterministicSeeds += 1;
  }
  const outputBytes = runs.reduce((sum, run) => sum + run.outputBytes, 0), auditBytes = runs.reduce((sum, run) => sum + run.auditBytes, 0);
  const auditRatio = outputBytes ? auditBytes / outputBytes : 0;
  if (auditRatio > maximumAuditRatio) issues.push({severity: "warning", code: "audit-ratio-above-gate", message: `${percent(auditRatio)} > ${percent(maximumAuditRatio)}`});
  const comparisons = runs.reduce((sum, run) => sum + run.comparisons, 0), agreements = runs.reduce((sum, run) => sum + run.agreements, 0);
  const fatalCount = issues.filter(issue => issue.severity === "fatal").length, warningCount = issues.length - fatalCount;
  const promotion = fatalCount ? "blocked" : warningCount ? "needs-review" : "soak-stable";
  return {
    schemaVersion: 1,
    runs: runs.map(run => ({...run})),
    issues,
    fatalCount,
    warningCount,
    promotion,
    metrics: {
      seeds: groups.size,
      runs: runs.length,
      deterministicSeeds,
      minimumCoverage: Math.min(...runs.map(run => run.coverage)),
      comparisons,
      agreements,
      auditWarnings: runs.reduce((sum, run) => sum + run.warningCount, 0),
      agreementRate: comparisons ? agreements / comparisons : 1,
      averageDurationMs: runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length,
      maximumDurationMs: Math.max(...runs.map(run => run.durationMs)),
      auditBytes,
      outputBytes,
      auditRatio,
    },
  };
}

export function whiteBoxSoakMarkdown(summary: WhiteBoxSoakSummary): string {
  const m = summary.metrics;
  return [`# 白箱 AI 固定种子浸泡报告`, "", `- 结论：${summary.promotion}`, `- 种子/运行：${m.seeds}/${m.runs}`, `- 结果与审计均确定的种子：${m.deterministicSeeds}/${m.seeds}`, `- 最低覆盖率：${percent(m.minimumCoverage)}`, `- 影子一致率：${m.agreements}/${m.comparisons}（${percent(m.agreementRate)}）`, `- 单次审计警告合计：${m.auditWarnings}`, `- 平均/最长运行：${(m.averageDurationMs / 1000).toFixed(1)}s / ${(m.maximumDurationMs / 1000).toFixed(1)}s`, `- 审计/总产物：${(m.auditBytes / 1048576).toFixed(2)}MB / ${(m.outputBytes / 1048576).toFixed(2)}MB（${percent(m.auditRatio)}）`, `- 浸泡门禁致命/警告：${summary.fatalCount}/${summary.warningCount}`, "", "## 运行", "", "| 种子 | 重复 | 耗时 | 覆盖 | 一致 | 结果摘要 | 审计摘要 |", "|---|---:|---:|---:|---:|---|---|", ...summary.runs.map(run => `| ${run.seed} | ${run.repeat} | ${(run.durationMs / 1000).toFixed(1)}s | ${percent(run.coverage)} | ${run.agreements}/${run.comparisons} | ${run.outcomeDigest.slice(0, 12)} | ${run.auditDigest.slice(0, 12)} |`), "", "## 问题", "", ...(summary.issues.length ? summary.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.code}${issue.seed ? ` ${issue.seed}` : ""}${issue.repeat ? ` r${issue.repeat}` : ""}：${issue.message}`) : ["未发现门禁问题。"]), ""].join("\n");
}

function percent(value: number): string {return `${(value * 100).toFixed(1)}%`;}
