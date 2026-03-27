// Simple stderr-based logger for the MCP server subprocess.
// stdout is reserved exclusively for JSON-RPC MCP protocol messages.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): Level {
  const env = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  return (env in LEVELS ? env : "info") as Level;
}

function write(level: Level, msg: string, meta?: object): void {
  if (LEVELS[level] > LEVELS[currentLevel()]) return;
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  const line = meta ? `${base} ${JSON.stringify(meta)}` : base;
  process.stderr.write(line + "\n");
}

export const logger = {
  error: (msg: string, meta?: object) => write("error", msg, meta),
  warn: (msg: string, meta?: object) => write("warn", msg, meta),
  info: (msg: string, meta?: object) => write("info", msg, meta),
  debug: (msg: string, meta?: object) => write("debug", msg, meta),
};
