import fs from "node:fs";
import path from "node:path";
import {writeSeasonBrief} from "../draft/seasonBrief";

const args = process.argv.slice(2), root = path.resolve(option("--out", "output/draft-league-v12"));
const requested = option("--season", "latest");
const state = JSON.parse(fs.readFileSync(path.join(root, "dynasty-state.json"), "utf8")) as {completedSeason: number};
const season = requested === "latest" ? state.completedSeason : Number(requested);
if (!Number.isInteger(season) || season < 1 || season > state.completedSeason) throw new Error(`Invalid season ${requested}`);
const seasonDir = path.join(root, `season-${String(season).padStart(2, "0")}`), {brief, budget} = writeSeasonBrief(seasonDir, root);
console.log(JSON.stringify({season, champion: brief.champion.name, audit: brief.audit, custom: brief.customPerformance.length, observations: brief.observations.length, characters: budget.briefCharacters, estimatedInputTokens: budget.estimatedInputTokens, estimatedTotalTokens: budget.estimatedStandardReportTotal, brief: path.join(seasonDir, "season-brief.json")}));
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
