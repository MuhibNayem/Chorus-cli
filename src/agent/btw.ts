export class BtwQueue {
  private readonly items: string[] = [];

  enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.items.push(trimmed);
  }

  drain(): string[] {
    return this.items.splice(0, this.items.length);
  }

  clear(): void {
    this.items.length = 0;
  }
}
