export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1;
    else nonAscii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.5));
}

export function extractOpenAiUsage(raw: any) {
  const usage = raw?.usage;
  if (!usage) return undefined;
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: Number(usage.total_tokens ?? prompt + completion),
  };
}

export function calcCost(
  inputPrice: unknown,
  outputPrice: unknown,
  promptTokens = 0,
  completionTokens = 0,
): number {
  const inPrice = inputPrice === null || inputPrice === undefined ? 0 : Number(inputPrice);
  const outPrice = outputPrice === null || outputPrice === undefined ? 0 : Number(outputPrice);
  return (promptTokens / 1_000_000) * inPrice + (completionTokens / 1_000_000) * outPrice;
}
