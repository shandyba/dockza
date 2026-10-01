export interface EnvVar {
  /** Everything before the first `=` (the whole entry when there is none). */
  name: string;
  /** Everything after the first `=`; `''` when the entry has none. */
  value: string;
  /** The entry exactly as docker reports it — what `NAME=value` copies hand out. */
  raw: string;
  hasValue: boolean;
}

/** Splits docker's `Config.Env` entries at the first `=` (values may contain `=` themselves). */
export function parseEnv(entries: string[]): EnvVar[] {
  return entries.map((raw) => {
    const eq = raw.indexOf('=');
    if (eq < 0) return { name: raw, value: '', raw, hasValue: false };
    return { name: raw.slice(0, eq), value: raw.slice(eq + 1), raw, hasValue: true };
  });
}

/** Every entry as `NAME=value`, one per line, in docker's order — the "copy all" payload. */
export function formatEnvAll(vars: EnvVar[]): string {
  return vars.map((v) => v.raw).join('\n');
}
