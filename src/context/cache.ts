export interface CachedMessage {
  role: string;
  content: string;
  reasoning_content?: string;
  timestamp: number;
}

export class MessageCache {
  private messages: CachedMessage[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  add(role: string, content: string, reasoning_content?: string): void {
    const msg: CachedMessage = {
      role,
      content,
      timestamp: Date.now(),
    };
    if (reasoning_content) {
      msg.reasoning_content = reasoning_content;
    }
    this.messages.push(msg);

    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
  }

  getAll(): CachedMessage[] {
    return [...this.messages];
  }

  getRecent(n: number): CachedMessage[] {
    return this.messages.slice(-n);
  }

  replaceAll(messages: Array<{ role: string; content: string; reasoning_content?: string }>): void {
    this.messages = messages.map((m) => ({
      ...m,
      timestamp: Date.now(),
    }));
  }

  clear(): void {
    this.messages = [];
  }

  size(): number {
    return this.messages.length;
  }
}
