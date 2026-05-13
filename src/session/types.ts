export interface SessionMessage {
  role: string;
  content: string;
  reasoning_content?: string;
}

export interface SessionMetadata {
  id: string;
  name: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isCompacted: boolean;
}

export interface SessionData extends SessionMetadata {
  messages: SessionMessage[];
}

export interface SessionIndex {
  sessions: SessionMetadata[];
}
