export function shouldRetainFullLineupTrace(decisionId: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.V4_WHITEBOX_FULL_LINEUP_TRACE === "true") return true;
  return String(environment.V4_WHITEBOX_FULL_LINEUP_TARGETS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .includes(decisionId);
}
