import type { OpikBatchPayload } from "./opik-types.js";

export class BatchQueue {
  private readonly items: OpikBatchPayload[] = [];

  constructor(
    private readonly maxSize: number,
    private readonly onEvictOldest?: (dropped: OpikBatchPayload) => void,
  ) {}

  push(batch: OpikBatchPayload): void {
    this.items.push(batch);
    while (this.items.length > this.maxSize) {
      const dropped = this.items.shift();
      if (dropped && this.onEvictOldest) {
        this.onEvictOldest(dropped);
      }
    }
  }

  drainBatch(max: number): OpikBatchPayload[] {
    const n = Math.min(max, this.items.length);
    if (n <= 0) {
      return [];
    }
    return this.items.splice(0, n);
  }

  get size(): number {
    return this.items.length;
  }
}
