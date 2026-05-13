interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Cost per 1M tokens in USD. Ollama models are free (local), so they have zero cost.
const PRICING: Record<string, ModelPricing> = {
  "openai/gpt-4o":                     { inputPer1M: 5.00,  outputPer1M: 15.00 },
  "openai/gpt-4o-mini":                { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "openai/gpt-4-turbo":                { inputPer1M: 10.00, outputPer1M: 30.00 },
  "openai/gpt-3.5-turbo":              { inputPer1M: 0.50,  outputPer1M: 1.50  },
  "anthropic/claude-3-5-sonnet":       { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "anthropic/claude-3-opus":           { inputPer1M: 15.00, outputPer1M: 75.00 },
  "anthropic/claude-3-haiku":          { inputPer1M: 0.25,  outputPer1M: 1.25  },
  "deepseek/deepseek-chat":            { inputPer1M: 0.14,  outputPer1M: 0.28  },
  "deepseek/deepseek-coder":           { inputPer1M: 0.14,  outputPer1M: 0.28  },
  "groq/llama3-8b-8192":               { inputPer1M: 0.05,  outputPer1M: 0.10  },
  "groq/llama3-70b-8192":              { inputPer1M: 0.59,  outputPer1M: 0.79  },
  "groq/mixtral-8x7b-32768":          { inputPer1M: 0.24,  outputPer1M: 0.24  },
};

// Ollama / local models are always free
function isLocalModel(model: string): boolean {
  return !model.includes("/") || model.startsWith("ollama/");
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  if (isLocalModel(model)) return 0;

  // Normalize model key: strip provider prefix if already included
  const key = model.toLowerCase();
  const pricing = PRICING[key] ?? { inputPer1M: 0, outputPer1M: 0 };

  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return "$0.000";
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function costColor(usd: number): string {
  if (usd < 0.05)  return "green";
  if (usd < 0.20)  return "yellow";
  return "red";
}
