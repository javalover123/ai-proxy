import { describe, expect, it } from "vitest";
import { extractTokenUsage, type SseEvent } from "./sse";

describe("extractTokenUsage", () => {
  it("聚合 Anthropic 的缓存读/写 token", () => {
    const events: SseEvent[] = [
      {
        event: "message_start",
        data: JSON.stringify({
          type: "message_start",
          message: {
            usage: {
              input_tokens: 100,
              cache_read_input_tokens: 40,
              cache_creation_input_tokens: 60,
            },
          },
        }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({
          type: "message_delta",
          usage: { output_tokens: 25 },
        }),
      },
    ];

    expect(extractTokenUsage(events)).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      cachedTokens: 40,
      cacheCreationTokens: 60,
    });
  });

  it("解析 OpenAI usage 的缓存命中 token", () => {
    const events: SseEvent[] = [
      {
        event: "message",
        data: JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 7 },
          },
        }),
      },
    ];

    expect(extractTokenUsage(events)).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedTokens: 7,
    });
  });

  it("无 usage 时返回 null", () => {
    expect(extractTokenUsage([])).toBeNull();
  });
});
