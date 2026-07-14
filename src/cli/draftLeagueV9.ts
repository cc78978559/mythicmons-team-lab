import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const env = {
  ...process.env,
  V4_STATE_VERSION: "9",
  V4_SEED: process.env.V9_SEED || "ecological-league-v9",
  V4_OUT: path.resolve(process.env.V9_OUT || "output/draft-league-v9"),
  V4_SEASONS: process.env.V9_SEASONS || "1",
  V4_MANAGER_LIMIT: process.env.V9_MANAGER_LIMIT || "30",
  V4_PAIRS: process.env.V9_PAIRS || "1",
  V4_POOL_SIZE: process.env.V9_POOL_SIZE || "420",
  V4_AUCTION_LOTS: process.env.V9_AUCTION_LOTS || "60",
  V4_REGULAR_ROUNDS: process.env.V9_REGULAR_ROUNDS || "24",
  V4_MAX_TURNS: process.env.V9_MAX_TURNS || "180",
  V4_RESUME: process.env.V9_RESUME || "false",
  V4_BASE_BUDGET: process.env.V9_BASE_BUDGET || "120",
  V4_KEEPER_CAP: process.env.V9_KEEPER_CAP || "72",
  V4_AUCTION_MODE: "portfolio",
  V4_MIN_ROSTER: process.env.V9_MIN_ROSTER || "6",
  V4_MAX_ROSTER: process.env.V9_MAX_ROSTER || "10",
  V4_MIDSEASON_GRANT: process.env.V9_MIDSEASON_GRANT || "8",
  V4_CONTRACT_MODEL: "market-arbitration",
  V4_LEARNING_MODEL: "counterfactual",
  V4_DYNAMIC_POOL: "true",
  V4_CARRY_RATE: process.env.V9_CARRY_RATE || ".5",
  V4_CARRY_CAP: process.env.V9_CARRY_CAP || "20",
};

const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV4.ts")], {cwd: root, env, encoding: "utf8", stdio: "inherit"});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
