import * as storage from "./storage.js";
import type { SessionData, SessionMessage, SessionMetadata } from "./types.js";

class SessionManager {
  private current: SessionData | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  createSession(): SessionData {
    const now = Date.now();
    const session: SessionData = {
      id:           crypto.randomUUID(),
      name:         "",
      workspace:    process.cwd(),
      createdAt:    now,
      updatedAt:    now,
      messageCount: 0,
      isCompacted:  false,
      messages:     [],
    };
    this.current = session;
    // Don't write to disk until there's something to save
    return session;
  }

  resumeSession(id: string): SessionMessage[] | null {
    const data = storage.loadSession(id);
    if (!data) return null;
    this.current = data;
    return data.messages;
  }

  onMessageAdded(messages: SessionMessage[]): void {
    if (!this.current) return;

    // Derive name from first user message if still unnamed
    if (!this.current.name) {
      const firstUser = messages.find((m) => m.role === "user");
      if (firstUser) {
        const raw = firstUser.content.trim().replace(/[\n\r/]/g, " ");
        this.current.name =
          raw.length > 40 ? raw.slice(0, 40).trimEnd() + "…" : raw;
      }
    }

    this.current.messages     = messages;
    this.current.messageCount = messages.length;
    this.current.updatedAt    = Date.now();
    this.current.isCompacted  =
      messages.length > 0 &&
      messages[0].role === "system" &&
      messages[0].content.startsWith("[Previous conversation summary:");

    // Debounced write
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const snapshot = { ...this.current, messages: [...messages] };
    this.saveTimer = setTimeout(() => {
      storage.saveSession(snapshot);
      this.saveTimer = null;
    }, 500);
  }

  renameSession(name: string): void {
    if (!this.current) return;
    this.current.name = name.trim();
    this.current.updatedAt = Date.now();
    storage.saveSession({ ...this.current });
  }

  getCurrent(): SessionData | null {
    return this.current;
  }

  listForWorkspace(): SessionMetadata[] {
    return storage.listSessionsForWorkspace(process.cwd());
  }

  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.current && this.current.messageCount > 0) {
      storage.saveSession({ ...this.current });
    }
  }
}

export const sessionManager = new SessionManager();
