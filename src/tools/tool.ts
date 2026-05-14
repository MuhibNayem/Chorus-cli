import type { z } from "zod";

export interface ToolMetadata<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
}

export interface AgentTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
  invoke(input: unknown): Promise<unknown>;
}

export function tool<TSchema extends z.ZodTypeAny>(
  fn: (input: z.infer<TSchema>) => Promise<unknown>,
  metadata: ToolMetadata<TSchema>,
): AgentTool<TSchema> {
  return {
    name: metadata.name,
    description: metadata.description,
    schema: metadata.schema,
    async invoke(input: unknown) {
      const parsed = metadata.schema.parse(input);
      return fn(parsed);
    },
  };
}
