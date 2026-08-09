export const LEAGUE_MECHANICS = Object.freeze({
  megaEvolution: true,
  dynamax: false,
  terastallization: false,
});

export function leagueBattleFormat(format: string, configuredRules: readonly string[] = []): string {
  if (!/^gen9/i.test(format)) return format;
  const present = new Set(configuredRules.map(rule => rule.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  const missing = [
    ...(!LEAGUE_MECHANICS.dynamax ? ["Dynamax Clause"] : []),
    ...(!LEAGUE_MECHANICS.terastallization ? ["Terastal Clause"] : []),
  ].filter(clause => !present.has(clause.toLowerCase().replace(/[^a-z0-9]+/g, "")) && !format.toLowerCase().includes(clause.toLowerCase()));
  if (!missing.length) return format;
  return format.includes("@@@") ? `${format},${missing.join(",")}` : `${format}@@@${missing.join(",")}`;
}
