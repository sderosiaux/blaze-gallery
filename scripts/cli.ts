/** Shared helpers of the maintenance scripts */

/** stdout line: the scripts' report channel (no-console only allows warn/error) */
export function out(message = ""): void {
  process.stdout.write(`${message}\n`);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
