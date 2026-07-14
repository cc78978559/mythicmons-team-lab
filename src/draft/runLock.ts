import fs from "node:fs";
import path from "node:path";

export interface RunLock {file: string; release(): void}

export function acquireRunLock(directory: string, context: Record<string, unknown> = {}): RunLock {
  fs.mkdirSync(directory, {recursive: true});
  const file = path.join(directory, ".run.lock");
  let descriptor: number;
  try { descriptor = fs.openSync(file, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = safeRead(file);
    throw new Error(`League output is already locked by another run: ${file}${owner ? ` (${owner.trim()})` : ""}`);
  }
  fs.writeFileSync(descriptor, `${JSON.stringify({schemaVersion: 1, pid: process.pid, startedAt: new Date().toISOString(), ...context})}\n`, "utf8");
  let released = false;
  return {file, release() { if (released) return; released = true; fs.closeSync(descriptor); fs.rmSync(file, {force: true}); }};
}
function safeRead(file: string): string { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
