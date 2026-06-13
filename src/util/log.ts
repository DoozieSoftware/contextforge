/**
 * Logger that writes to stderr only. stdout is reserved for markdown output.
 */
function write(stream: NodeJS.WriteStream, level: string, msg: string): void {
  if (process.env.CTX_QUIET === "1") return;
  const line = msg.endsWith("\n") ? msg : msg + "\n";
  stream.write(`[${level}] ${line}`);
}

export const log = {
  info(msg: string): void {
    write(process.stderr, "info", msg);
  },
  warn(msg: string): void {
    write(process.stderr, "warn", msg);
  },
  error(msg: string): void {
    write(process.stderr, "error", msg);
  },
  debug(msg: string): void {
    if (process.env.CTX_DEBUG === "1") {
      write(process.stderr, "debug", msg);
    }
  },
};
