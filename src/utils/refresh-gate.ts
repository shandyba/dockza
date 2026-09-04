/**
 * Serializes one polled fetch and discards results a mutation has outraced.
 *
 * Every fetch carries the generation it was issued under; a mutation bumps the
 * generation, so a fetch that overlapped it fails `isCurrent` and is dropped
 * instead of writing a pre-mutation snapshot over post-mutation truth.
 *
 * `task` must not reject — it reports its own errors (see `App.fetch*`).
 */
export class RefreshGate {
  private generation = 0;
  private inFlight = 0;

  constructor(private readonly task: (token: number) => Promise<void>) {}

  /** Token to capture before issuing IO and to re-check before applying it. */
  token(): number {
    return this.generation;
  }

  /** False once a mutation (or a newer fetch) has superseded this fetch. */
  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  /** Marks every in-flight fetch stale without scheduling a new one. */
  invalidate(): void {
    this.generation++;
  }

  /** Interval tick. Skipped while a fetch is in flight so a slow daemon can't stack up requests. */
  async poll(): Promise<void> {
    if (this.inFlight > 0) return;
    await this.run();
  }

  /** Post-mutation refetch. Never skipped, never queued behind the stale fetch it invalidates. */
  async force(): Promise<void> {
    this.invalidate();
    await this.run();
  }

  private async run(): Promise<void> {
    this.inFlight++;
    try {
      await this.task(this.generation);
    } finally {
      this.inFlight--;
    }
  }
}
