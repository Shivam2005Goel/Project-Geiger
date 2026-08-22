/** Shared bootstrap for every CLI script: load .env before anything reads it. */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/** Minimal flag parser: --key value, --key=value and --flag. */
export function args(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    if (inline !== undefined) {
      out[key] = inline;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[key] = argv[i + 1];
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function num(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function list(value: string | boolean | undefined): string[] {
  return typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const started = Date.now();
export function elapsed(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`;
}

export function log(message: string): void {
  process.stdout.write(`[${elapsed()}] ${message}\n`);
}

/** Fail loudly and early rather than half-completing a run. */
export function fatal(message: string): never {
  process.stderr.write(`\nError: ${message}\n\n`);
  process.exit(1);
}
