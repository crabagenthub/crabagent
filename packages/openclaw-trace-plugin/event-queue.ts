export type QueuedEvent = Record<string, unknown>;

export class EventQueue {
  private readonly items: QueuedEvent[] = [];

  constructor(private readonly maxSize: number) {}

  push(event: QueuedEvent): void {
    this.items.push(event);
    while (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  drainBatch(max: number): QueuedEvent[] {
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
