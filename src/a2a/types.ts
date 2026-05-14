/**
 * A2A Protocol Types — Google's Agent-to-Agent open protocol
 * (Linux Foundation, 150+ organizations as of 2026).
 *
 * Chorus implements the server-side (exposing swarms as A2A agents)
 * and client-side (calling external A2A agents from within a swarm).
 */

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentCard {
  /** Unique agent identifier URI */
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransition: boolean;
  };
  /** Supported content MIME types */
  inputModes: string[];
  outputModes: string[];
  /** Authentication requirements */
  authentication?: {
    type: "bearer" | "api-key" | "none";
    scheme?: string;
  };
  endpoints: {
    tasks: string;
    wellKnown: string;
  };
}

export interface TaskMessage {
  role: "user" | "agent";
  content: Array<{
    type: "text" | "file" | "data";
    text?: string;
    mimeType?: string;
    data?: string;
  }>;
}

export interface Task {
  id: string;
  agentId: string;
  state: TaskState;
  messages: TaskMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface TaskSendParams {
  id?: string;
  message: TaskMessage;
  metadata?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  type: "task-status-update";
  taskId: string;
  status: { state: TaskState; message?: string };
  final: boolean;
}

export interface TaskArtifactUpdateEvent {
  type: "task-artifact-update";
  taskId: string;
  artifact: { name?: string; parts: TaskMessage["content"] };
  final?: boolean;
}

export type TaskStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: A2AError;
}
