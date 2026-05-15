import { tool } from "./tool.js";
import { z } from "zod";

const TodoItemSchema = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const WriteTodosTool = tool(
  async ({ todos }: { todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> }) => {
    const done = todos.filter((t) => t.status === "completed").length;
    const active = todos.filter((t) => t.status === "in_progress").length;
    return `${done}/${todos.length} done · ${active} in progress`;
  },
  {
    name: "write_todos",
    description: "Display or update a visible todo checklist for the user. Call this to plan tasks, mark steps in_progress, or mark them completed.",
    schema: z.object({
      todos: z.array(TodoItemSchema).describe("Array of todo items with content and status"),
    }),
  }
);
