import fs from "node:fs";
import path from "node:path";
import type {BenchmarkPool} from "./types";

export interface LoadedBenchmarkPool extends BenchmarkPool {
  rootDir: string;
}

export function loadBenchmarkPool(manifestPath: string): LoadedBenchmarkPool {
  const resolvedPath = path.resolve(manifestPath);
  const pool = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as BenchmarkPool;
  if (!pool.id || !pool.format || !Array.isArray(pool.benchmarks)) {
    throw new Error("Benchmark manifest must include id, format, and benchmarks[]");
  }
  return {
    ...pool,
    rootDir: path.dirname(resolvedPath),
  };
}

export function benchmarkTeamPath(pool: LoadedBenchmarkPool, teamPath: string): string {
  const resolvedPath = path.resolve(pool.rootDir, teamPath);
  const relative = path.relative(pool.rootDir, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Benchmark team path escapes benchmark pool directory: ${teamPath}`);
  }
  return resolvedPath;
}
