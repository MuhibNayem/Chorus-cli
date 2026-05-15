import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider, VllmProvider } from "../src/llm/index.js";
import type { ToolDef, ToolStreamEvent } from "../src/llm/provider.js";

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "internet_search",
      description: "Search the web",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
];

async function collect(stream: AsyncIterable<ToolStreamEvent>): Promise<ToolStreamEvent[]> {
  const events: ToolStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function streamResponse(body: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VllmProvider.streamWithTools", () => {
  it("accumulates OpenAI-compatible streaming tool call deltas", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"Need search. "}}]}',
          'data: {"choices":[{"delta":{"content":"I will check."}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"internet_"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"query\\":\\"iphone"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" 17\\"}"}}]}}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new VllmProvider({ name: "vllm", baseUrl: "http://vllm.test/v1", apiKey: "test-key" });
    const events = await collect(
      provider.streamWithTools({
        model: "test-model",
        systemPrompt: "You are useful.",
        messages: [{ role: "user", content: "Find the price" }],
        tools,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vllm.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "test-model",
      stream: true,
      tools,
      messages: [
        { role: "system", content: "You are useful." },
        { role: "user", content: "Find the price" },
      ],
    });

    expect(events).toEqual([
      { type: "thinking", text: "Need search. " },
      { type: "token", text: "I will check." },
      {
        type: "done",
        response: {
          content: "I will check.",
          reasoning_content: "Need search. ",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "internet_search",
                arguments: '{"query":"iphone 17"}',
              },
            },
          ],
        },
      },
    ]);
  });

  it("emits a final response when the provider closes without a DONE sentinel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n'),
      ),
    );

    const provider = new VllmProvider({ baseUrl: "http://vllm.test/v1", apiKey: "test-key" });
    const events = await collect(
      provider.streamWithTools({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
        tools,
      }),
    );

    expect(events).toEqual([
      { type: "token", text: "partial" },
      { type: "done", response: { content: "partial" } },
    ]);
  });
});

describe("OllamaProvider.streamWithTools", () => {
  it("streams tokens and converts Ollama tool call objects to OpenAI-compatible calls", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(
        [
          '{"message":{"thinking":"Plan. "},"done":false}',
          '{"message":{"content":"Checking","tool_calls":[{"function":{"name":"internet_search","arguments":{"query":"iphone 17"}}}]},"done":false}',
          '{"done":true}',
          "",
        ].join("\n"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider({ baseUrl: "http://ollama.test" });
    const events = await collect(
      provider.streamWithTools({
        model: "llama3.1",
        messages: [{ role: "user", content: "Find it" }],
        tools,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama.test/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "llama3.1",
      stream: true,
      tools,
      messages: [{ role: "user", content: "Find it" }],
    });
    expect(events).toEqual([
      { type: "thinking", text: "Plan. " },
      { type: "token", text: "Checking" },
      {
        type: "done",
        response: {
          content: "Checking",
          reasoning_content: "Plan. ",
          tool_calls: [
            {
              id: "ollama-tool-0",
              type: "function",
              function: {
                name: "internet_search",
                arguments: '{"query":"iphone 17"}',
              },
            },
          ],
        },
      },
    ]);
  });

  it("sends prior tool calls back to Ollama with object arguments", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse('{"message":{"content":"done"},"done":true}\n'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaProvider({ baseUrl: "http://ollama.test" });
    await collect(
      provider.streamWithTools({
        model: "llama3.1",
        messages: [
          { role: "user", content: "Find it" },
          {
            role: "assistant",
            content: "",
            reasoning_content: "Need search.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "internet_search",
                  arguments: '{"query":"iphone 17"}',
                },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "result" },
        ],
        tools,
      }),
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      messages: [
        { role: "user", content: "Find it" },
        {
          role: "assistant",
          content: "",
          thinking: "Need search.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "internet_search",
                arguments: { query: "iphone 17" },
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
    });
  });

  it("accumulates Ollama string tool argument fragments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse(
          [
            '{"message":{"tool_calls":[{"function":{"name":"internet_search","arguments":"{\\"query\\":\\"iphone"}}]},"done":false}',
            '{"message":{"tool_calls":[{"function":{"arguments":" 17\\"}"}}]},"done":false}',
            '{"done":true}',
            "",
          ].join("\n"),
        ),
      ),
    );

    const provider = new OllamaProvider({ baseUrl: "http://ollama.test" });
    const events = await collect(
      provider.streamWithTools({
        model: "llama3.1",
        messages: [{ role: "user", content: "Find it" }],
        tools,
      }),
    );

    expect(events.at(-1)).toEqual({
      type: "done",
      response: {
        content: "",
        tool_calls: [
          {
            id: "ollama-tool-0",
            type: "function",
            function: {
              name: "internet_search",
              arguments: '{"query":"iphone 17"}',
            },
          },
        ],
      },
    });
  });
});

describe("VllmProvider.streamWithTools <think> tag fallback", () => {
  it("parses <think> tags from content when reasoning_content is absent", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(
        [
          'data: {"choices":[{"delta":{"content":"<think>Need search. "}}]}',
          'data: {"choices":[{"delta":{"content":"</think>I will check."}}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new VllmProvider({ name: "vllm", baseUrl: "http://vllm.test/v1", apiKey: "test-key" });
    const events = await collect(
      provider.streamWithTools({
        model: "test-model",
        messages: [{ role: "user", content: "Find the price" }],
        tools,
      }),
    );

    expect(events).toEqual([
      { type: "thinking", text: "Need search. " },
      { type: "token", text: "I will check." },
      {
        type: "done",
        response: {
          content: "I will check.",
          reasoning_content: "Need search. ",
        },
      },
    ]);
  });

  it("prefers native reasoning_content over <think> tags", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"Native reasoning. ","content":"<think>ignored</think>"}}]}',
          'data: {"choices":[{"delta":{"content":"Answer."}}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new VllmProvider({ name: "vllm", baseUrl: "http://vllm.test/v1", apiKey: "test-key" });
    const events = await collect(
      provider.streamWithTools({
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
        tools,
      }),
    );

    expect(events).toEqual([
      { type: "thinking", text: "Native reasoning. " },
      { type: "token", text: "<think>ignored</think>" },
      { type: "token", text: "Answer." },
      {
        type: "done",
        response: {
          content: "<think>ignored</think>Answer.",
          reasoning_content: "Native reasoning. ",
        },
      },
    ]);
  });
});
