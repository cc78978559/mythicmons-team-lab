import path from "node:path";
import {spawnSync} from "node:child_process";
import {writeCareerCheckpointFromWhiteBoxRelease} from "../ai/whiteBox/release";

const root = process.cwd();
const output = path.resolve(process.env.V12_OUT || "output/draft-league-v12");
const aiRelease = process.env.V12_AI_RELEASE ? path.resolve(process.env.V12_AI_RELEASE) : "";
if (aiRelease && process.env.V12_CAREER_CHECKPOINT) throw new Error("V12_AI_RELEASE cannot be combined with V12_CAREER_CHECKPOINT");
if (aiRelease && /^(1|true|yes)$/i.test(process.env.V12_RESUME || "false")) throw new Error("V12_AI_RELEASE starts a new journey and cannot be combined with V12_RESUME");
const importedCheckpoint = aiRelease ? writeCareerCheckpointFromWhiteBoxRelease(aiRelease, path.join(output, ".whitebox-ai-import"), true).manifest : process.env.V12_CAREER_CHECKPOINT || "";
const env = {
  ...process.env,
  V4_STATE_VERSION: "12", V4_DUAL_LAYER: "true", V4_PROGRAM_EVOLUTION: "true",
  V4_SEED: process.env.V12_SEED || "self-programming-v12",
  V4_OUT: output,
  V4_SEASONS: process.env.V12_SEASONS || "1",
  V4_MANAGER_LIMIT: process.env.V12_MANAGER_LIMIT || "30",
  V4_PAIRS: process.env.V12_PAIRS || "1",
  V4_POOL_SIZE: process.env.V12_POOL_SIZE || "420",
  V4_AUCTION_LOTS: process.env.V12_AUCTION_LOTS || "60",
  V4_REGULAR_ROUNDS: process.env.V12_REGULAR_ROUNDS || "24",
  V4_MAX_TURNS: process.env.V12_MAX_TURNS || "180",
  V4_RESUME: process.env.V12_RESUME || "false",
  V4_ADOPT_REGISTRY: process.env.V12_ADOPT_REGISTRY || "false",
  V4_ALLOW_CODE_UPGRADE: process.env.V12_ALLOW_CODE_UPGRADE || "false",
  V4_CAREER_CHECKPOINT: importedCheckpoint,
  V4_EVIDENCE_RETENTION: process.env.V12_EVIDENCE_RETENTION || "compact",
  V4_EVIDENCE_SAMPLE_RATE: process.env.V12_EVIDENCE_SAMPLE_RATE || "0.02",
  V4_EVOLUTION_MODE: process.env.V12_EVOLUTION_MODE || process.env.V4_EVOLUTION_MODE || "punctuated",
  V4_EVOLUTION_SHOCK: process.env.V12_EVOLUTION_SHOCK || process.env.V4_EVOLUTION_SHOCK || "0",
  V4_EVOLUTION_MAX_BURSTS: process.env.V12_EVOLUTION_MAX_BURSTS || process.env.V4_EVOLUTION_MAX_BURSTS || "2",
  V4_EVOLUTION_MIN_CANDIDATES: process.env.V12_EVOLUTION_MIN_CANDIDATES || process.env.V4_EVOLUTION_MIN_CANDIDATES || "4",
  V4_EVOLUTION_MAX_CANDIDATES: process.env.V12_EVOLUTION_MAX_CANDIDATES || process.env.V4_EVOLUTION_MAX_CANDIDATES || "8",
  V4_EVOLUTION_POLICY: process.env.V12_EVOLUTION_POLICY || process.env.V4_EVOLUTION_POLICY || "shadow",
  V4_EVOLUTION_POLICY_TARGET: process.env.V12_EVOLUTION_POLICY_TARGET || process.env.V4_EVOLUTION_POLICY_TARGET || "",
  V4_BATTLE_ASSIST_APPROVAL: process.env.V12_BATTLE_ASSIST_APPROVAL || process.env.V4_BATTLE_ASSIST_APPROVAL || "",
  V4_REGISTRY_SOURCE: process.env.V12_REGISTRY_SOURCE || path.resolve("data/draft"),
  V4_REGISTRY_REVISION: process.env.V12_REGISTRY_REVISION || "",
  V4_BASE_BUDGET: process.env.V12_BASE_CASH || "40",
  V4_KEEPER_CAP: "120", V4_MAX_KEEPERS: process.env.V12_MAX_ROSTER || "10", V4_SEPARATE_PAYROLL: "true",
  V3_SPORTS_MARKET: "true", V3_DUAL_LAYER: "true", V3_PROGRAM_EVOLUTION: "true",
  V4_AUCTION_MODE: "portfolio", V4_MIN_ROSTER: process.env.V12_MIN_ROSTER || "6", V4_MAX_ROSTER: process.env.V12_MAX_ROSTER || "10",
  V4_MIDSEASON_GRANT: "0", V4_CONTRACT_MODEL: "sports-market", V4_LEARNING_MODEL: "counterfactual", V4_DYNAMIC_POOL: "false", V4_CARRY_RATE: "0", V4_CARRY_CAP: "0",
};
const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV4.ts")], {cwd: root, env, encoding: "utf8", stdio: "inherit"});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
