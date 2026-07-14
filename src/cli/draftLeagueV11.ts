import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const env = {
  ...process.env,
  V4_STATE_VERSION: "11",
  V4_DUAL_LAYER: "true",
  V4_SEED: process.env.V11_SEED || "dual-ecosystem-v11",
  V4_OUT: path.resolve(process.env.V11_OUT || "output/draft-league-v11"),
  V4_SEASONS: process.env.V11_SEASONS || "1",
  V4_MANAGER_LIMIT: process.env.V11_MANAGER_LIMIT || "30",
  V4_PAIRS: process.env.V11_PAIRS || "1",
  V4_POOL_SIZE: process.env.V11_POOL_SIZE || "420",
  V4_AUCTION_LOTS: process.env.V11_AUCTION_LOTS || "60",
  V4_REGULAR_ROUNDS: process.env.V11_REGULAR_ROUNDS || "24",
  V4_MAX_TURNS: process.env.V11_MAX_TURNS || "180",
  V4_RESUME: process.env.V11_RESUME || "false",
  V4_BASE_BUDGET: process.env.V11_BASE_CASH || "40",
  V4_KEEPER_CAP: "120",
  V4_MAX_KEEPERS: process.env.V11_MAX_ROSTER || "10",
  V4_SEPARATE_PAYROLL: "true",
  V3_SPORTS_MARKET: "true",
  V3_DUAL_LAYER: "true",
  V4_AUCTION_MODE: "portfolio",
  V4_MIN_ROSTER: process.env.V11_MIN_ROSTER || "6",
  V4_MAX_ROSTER: process.env.V11_MAX_ROSTER || "10",
  V4_MIDSEASON_GRANT: "0",
  V4_CONTRACT_MODEL: "sports-market",
  V4_LEARNING_MODEL: "counterfactual",
  V4_DYNAMIC_POOL: "false",
  V4_CARRY_RATE: "0",
  V4_CARRY_CAP: "0",
};

const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV4.ts")], {cwd: root, env, encoding: "utf8", stdio: "inherit"});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
