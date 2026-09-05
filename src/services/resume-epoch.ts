/** Durable identity for one resumed summon turn. */
export type ResumeEpoch = string;

/** Per-room sequence prevents same-millisecond resume tokens from colliding. */
export class ResumeEpochRegistry {
  private readonly seq = new Map<string, number>();

  mint(roomId: string): ResumeEpoch {
    const next = (this.seq.get(roomId) ?? 0) + 1;
    this.seq.set(roomId, next);
    return `${new Date().toISOString()}#${next}`;
  }

  observe(roomId: string, token: ResumeEpoch | undefined): void {
    if (!token) return;
    const suffix = token.slice(token.lastIndexOf("#") + 1);
    const seq = Number.parseInt(suffix, 10);
    if (Number.isSafeInteger(seq) && seq > (this.seq.get(roomId) ?? 0)) this.seq.set(roomId, seq);
  }
}
