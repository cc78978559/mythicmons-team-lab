export type Args = Record<string, string | boolean | undefined>;

export function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    if (key.startsWith("no-")) {
      args[key.slice(3)] = false;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

export function stringArg(args: Args, key: string, fallback?: string): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${key}`);
}

export interface NumberArgOptions {
  integer?: boolean;
  min?: number;
}

export function numberArg(args: Args, key: string, fallback: number, options: NumberArgOptions = {}): number {
  const value = args[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`--${key} must be an integer`);
  if (options.min !== undefined && parsed < options.min) throw new Error(`--${key} must be at least ${options.min}`);
  return parsed;
}

export function booleanArg(args: Args, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  return fallback;
}
