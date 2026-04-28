// Shared provider metadata — used by Header's ProviderPicker, the model
// picker, and the SetupView so all three converge on a single source of
// truth for which providers exist and their defaults.

import type { ProviderName } from "../hooks/useSettings";

export interface ProviderMeta {
  readonly id: ProviderName;
  readonly label: string;
  readonly defaultModel: string;
  /** Static fallback model list — used when /v1/models isn't available. */
  readonly fallbackModels: readonly string[];
}

export const PROVIDER_LIST: readonly ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-6",
    fallbackModels: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    fallbackModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openrouter/auto",
    fallbackModels: ["openrouter/auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
  },
  {
    id: "groq",
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    fallbackModels: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    fallbackModels: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    fallbackModels: ["deepseek-chat", "deepseek-coder"],
  },
  {
    id: "together",
    label: "Together AI",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    fallbackModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  {
    id: "gemini",
    label: "Gemini",
    defaultModel: "gemini-2.0-flash",
    fallbackModels: ["gemini-2.0-flash", "gemini-2.5-pro"],
  },
  {
    id: "bedrock",
    label: "AWS Bedrock",
    defaultModel: "anthropic.claude-sonnet-4-6-v1",
    fallbackModels: ["anthropic.claude-sonnet-4-6-v1", "anthropic.claude-opus-4-1"],
  },
  {
    id: "ollama",
    label: "Ollama",
    defaultModel: "llama3.2",
    fallbackModels: ["llama3.2", "llama3.1", "qwen2.5-coder"],
  },
];

export function getProviderMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_LIST.find((p) => p.id === id);
}
