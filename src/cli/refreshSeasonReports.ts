import fs from "node:fs";
import path from "node:path";

interface PoolAsset { assetId: string; name: string; scarcity: string }
interface RosterMember {
  assetId?: string;
  pokemon: string;
  method: "auction" | "supplemental" | "keeper" | "free-agent";
  scarcity?: string;
  price: number;
  appearances: number;
  kos: number;
  regularSeasonAppearances: number;
  regularSeasonKos: number;
}
interface RosterFile {manager: string; members: RosterMember[]}

const dynastyDir = path.resolve(process.argv[2] || "output/draft-league-v4");
const seasonDirs = fs.readdirSync(dynastyDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory() && /^season-\d+$/.test(entry.name))
  .map(entry => path.join(dynastyDir, entry.name));

for (const seasonDir of seasonDirs) refreshSeason(seasonDir);
process.stdout.write(`Refreshed ${seasonDirs.length} season report(s) in ${dynastyDir}\n`);

function refreshSeason(seasonDir: string): void {
  const reportPath = path.join(seasonDir, "season-review.md");
  const pool = readJson<PoolAsset[]>(path.join(seasonDir, "season-pool.json"));
  const rosterDir = path.join(seasonDir, "rosters");
  const owned = fs.readdirSync(rosterDir).flatMap(managerId => {
    const roster = readJson<RosterFile>(path.join(rosterDir, managerId, "roster.json"));
    return roster.members.filter(member => member.scarcity === "unique-custom").map(member => ({manager: roster.manager, member}));
  });
  const ownedIds = new Set(owned.map(entry => entry.member.assetId));
  const unowned = pool.filter(asset => asset.scarcity === "unique-custom" && !ownedIds.has(asset.assetId));
  const section = [
    "## 魔改宝可梦表现",
    "",
    "| 魔改宝可梦 | 经理 | 获得方式 | 价格 | 出场 | 击倒 | 常规赛出场 | 常规赛击倒 |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...owned.sort((a, b) => b.member.kos - a.member.kos).map(({manager, member}) => `| [魔改] ${member.pokemon} | ${manager} | ${methodName(member.method)} | ${member.price} | ${member.appearances} | ${member.kos} | ${member.regularSeasonAppearances} | ${member.regularSeasonKos} |`),
    "",
    `未成交魔改（${unowned.length}）：${unowned.map(asset => `[魔改] ${asset.name}`).join("、") || "无"}。`,
    "",
  ].join("\n");
  const existing = fs.readFileSync(reportPath, "utf8");
  const withoutOldSection = existing.split("\n## 魔改宝可梦表现\n")[0].trimEnd();
  fs.writeFileSync(reportPath, `${withoutOldSection}\n\n${section}`, "utf8");
}

function methodName(method: RosterMember["method"]): string {
  return method === "auction" ? "竞拍" : method === "keeper" ? "续约" : method === "free-agent" ? "自由签约" : "补强";
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
