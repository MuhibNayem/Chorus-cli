export interface OllamaStreamOptions {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  onThink: (text: string) => void;
  onResponse: (text: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export async function streamOllama(options: OllamaStreamOptions): Promise<void> {
  const { baseUrl, model, systemPrompt, messages, onResponse, onComplete, onError } = options;

  const prompt = buildPrompt(systemPrompt, messages);

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model, prompt, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }
    if (!response.body) {
      throw new Error("No response body");
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const chunk  = parsed.response ?? "";
          if (chunk) onResponse(chunk);
        } catch { /* skip malformed JSON */ }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        const chunk  = parsed.response ?? "";
        if (chunk) onResponse(chunk);
      } catch { /* skip */ }
    }

    onComplete();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function buildPrompt(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): string {
  let prompt = systemPrompt + "\n\n";
  for (const msg of messages) {
    prompt += `\n${msg.role}: ${msg.content}`;
  }
  return prompt;
}
