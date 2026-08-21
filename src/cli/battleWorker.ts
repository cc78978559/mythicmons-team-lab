import readline from "node:readline";
import {runBattle, type BattleInput} from "../showdown/battle";

if (process.env.MYTHICMONS_BATTLE_WORKER !== "1") throw new Error("battleWorker is an internal worker entry point");

async function main(): Promise<void> {
  const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as {type: "battle" | "close"; id?: number; input?: BattleInput};
    if (message.type === "close") break;
    const id = Number(message.id);
    try {
      if (!Number.isInteger(id) || !message.input) throw new Error("Invalid battle worker request");
      const result = await runBattle(message.input);
      process.stdout.write(`${JSON.stringify({id, ok: true, result})}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({id, ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error)})}\n`);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
