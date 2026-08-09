import type {AiDecisionTrace} from "../showdown/choice";

export const SEMANTIC_DECISION_TRACE_POLICY = "semantic-decision-trace-v1" as const;

export function semanticTraceEqual(left: readonly AiDecisionTrace[], right: readonly AiDecisionTrace[]): boolean {
  return JSON.stringify(semanticTrace(left)) === JSON.stringify(semanticTrace(right));
}

function semanticTrace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticTrace);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !["diagnostics", "timing", "elapsedMs", "durationMs"].includes(key)).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, semanticTrace(entry)]));
  if (typeof value === "number" && Number.isFinite(value)) return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  return value;
}
