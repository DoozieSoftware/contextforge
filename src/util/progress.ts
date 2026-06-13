/**
 * Throttled stderr progress reporter. Throttles to one update per 250ms so
 * the user sees motion without flooding the terminal. Suppresses output
 * entirely when stderr isn't a TTY (e.g. piped) or when CTX_QUIET=1.
 */
export class Progress {
  private lastEmit = 0;
  private lastMessage = "";
  private count = 0;
  private total: number;
  private label: string;

  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
  }

  tick(n = 1): void {
    this.count += n;
    const now = Date.now();
    if (now - this.lastEmit < 250 && this.count < this.total) return;
    this.lastEmit = now;
    if (process.env.CTX_QUIET === "1") return;
    if (!process.stderr.isTTY) return;
    const msg = `[${this.label}] ${this.count}/${this.total}`;
    if (msg === this.lastMessage) return;
    this.lastMessage = msg;
    process.stderr.write(`\r${msg.padEnd(40, " ")}`);
    if (this.count >= this.total) process.stderr.write("\n");
  }

  done(): void {
    this.count = this.total;
    this.tick(0);
  }
}
