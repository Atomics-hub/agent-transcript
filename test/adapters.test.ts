import { describe, expect, it } from "vitest";
import {
  fromAISDKModelMessages,
  fromAnthropicMessages,
  fromGeminiContents,
  fromOpenAIChatMessages,
} from "../src/adapters.js";

describe("provider adapters", () => {
  it("converts OpenAI Chat tool turns", () => {
    const result = fromOpenAIChatMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "x",
            type: "function",
            function: { name: "go", arguments: '{"n":1}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "x", content: '{"ok":true}' },
    ]);
    expect(result.messages[0]?.parts[0]).toMatchObject({
      type: "tool-call",
      input: { n: 1 },
    });
    expect(result.messages[1]?.parts[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "x",
    });
  });

  it("preserves malformed OpenAI arguments for the auditor", () => {
    const result = fromOpenAIChatMessages([
      {
        role: "assistant",
        tool_calls: [{ id: "x", function: { name: "go", arguments: '{"n":' } }],
      },
    ]);
    expect(result.messages[0]?.parts[0]).toMatchObject({ input: '{"n":' });
  });

  it("converts Anthropic caller references and results", () => {
    const result = fromAnthropicMessages([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm", signature: "s" },
          {
            type: "tool_use",
            id: "child",
            name: "go",
            input: {},
            caller: { tool_id: "parent" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "child", content: "ok" }],
      },
    ]);
    expect(result.messages[0]?.parts[0]).toMatchObject({
      type: "reasoning",
      signatureProvider: "anthropic",
    });
    expect(result.messages[0]?.parts[1]).toMatchObject({ callerId: "parent" });
  });

  it("keeps Gemini parallel calls grouped in one model turn", () => {
    const result = fromGeminiContents([
      {
        role: "model",
        parts: [
          {
            functionCall: { id: "a", name: "one", args: {} },
            thoughtSignature: "sig",
          },
          { functionCall: { id: "b", name: "two", args: {} } },
        ],
      },
    ]);
    const calls = result.messages[0]?.parts;
    expect(calls?.[0]).toMatchObject({
      groupId: "gemini-turn-0",
      signature: "sig",
    });
    expect(calls?.[1]).toMatchObject({ groupId: "gemini-turn-0" });
  });

  it("converts AI SDK caller metadata", () => {
    const result = fromAISDKModelMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "child",
            toolName: "go",
            input: {},
            providerOptions: { anthropic: { caller: { toolId: "parent" } } },
          },
        ],
      },
    ]);
    expect(result.messages[0]?.parts[0]).toMatchObject({ callerId: "parent" });
  });

  it("returns diagnostics instead of throwing on malformed provider arrays", () => {
    for (const adapter of [
      fromOpenAIChatMessages,
      fromAnthropicMessages,
      fromGeminiContents,
      fromAISDKModelMessages,
    ]) {
      expect(adapter(null).diagnostics).toHaveLength(1);
      expect(adapter([null]).diagnostics).toHaveLength(1);
    }
  });
});
