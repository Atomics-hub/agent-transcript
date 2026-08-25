import { describe, expect, it } from "vitest";
import { auditTranscript } from "../src/index.js";
import {
  fromAISDKModelMessages,
  fromAnthropicMessages,
  fromGeminiContents,
  fromOpenAIChatMessages,
} from "../src/adapters.js";

describe("audit edge cases", () => {
  it("audits empty and unknown parts without throwing", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          null,
          { type: "text", text: "" },
          { type: "provider", provider: "x", kind: "future", data: {} },
        ],
      },
    ]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "invalid-message",
      "empty-text",
    ]);
  });

  it("rejects invalid call identity, array input, and missing result", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          { type: "tool-call", id: " ", name: "", input: [] },
          { type: "tool-call", id: "valid", name: "go", input: [] },
        ],
      },
    ]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "invalid-message",
      "invalid-tool-input",
      "invalid-tool-input",
      "missing-tool-result",
    ]);
  });

  it("accepts a valid nested caller reference", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          { type: "tool-call", id: "parent", name: "code", input: {} },
          {
            type: "tool-call",
            id: "child",
            name: "lookup",
            input: {},
            callerId: "parent",
          },
        ],
      },
      {
        role: "tool",
        parts: [
          { type: "tool-result", toolCallId: "parent", output: null },
          { type: "tool-result", toolCallId: "child", output: null },
        ],
      },
    ]);
    expect(result.replayable).toBe(true);
  });

  it("checks target-specific result roles", () => {
    const history = [
      {
        role: "assistant",
        parts: [{ type: "tool-call", id: "x", name: "go", input: {} }],
      },
      {
        role: "user",
        parts: [{ type: "tool-result", toolCallId: "x", output: null }],
      },
    ];
    expect(
      auditTranscript(history, { target: "openai-chat" }).diagnostics[0]?.code,
    ).toBe("tool-result-role");
    expect(auditTranscript(history, { target: "gemini" }).replayable).toBe(
      true,
    );

    const anthropicWrongRole = [history[0], { ...history[1], role: "tool" }];
    expect(
      auditTranscript(anthropicWrongRole, { target: "anthropic" })
        .diagnostics[0]?.code,
    ).toBe("tool-result-role");
  });

  it("detects mismatched result names", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [{ type: "tool-call", id: "x", name: "expected", input: {} }],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "x",
            name: "wrong",
            output: null,
          },
        ],
      },
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      code: "tool-name-mismatch",
      relatedPath: "messages[0].parts[0]",
    });
  });

  it("accepts same-message parallel groups and matching signatures", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: "plan",
              signature: "r",
              signatureProvider: "google",
            },
            {
              type: "tool-call",
              id: "a",
              name: "one",
              input: {},
              groupId: "g",
              signature: "s",
              signatureProvider: "google",
            },
            {
              type: "tool-call",
              id: "b",
              name: "two",
              input: {},
              groupId: "g",
            },
          ],
        },
      ],
      { target: "gemini-thinking", allowIncompleteTail: true },
    );
    expect(
      result.diagnostics.filter(
        (item) => item.code === "missing-thought-signature",
      ),
    ).toHaveLength(0);
  });

  it("detects foreign reasoning signatures", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              signature: "x",
              signatureProvider: "anthropic",
            },
          ],
        },
      ],
      { target: "gemini" },
    );
    expect(result.diagnostics[0]?.code).toBe("foreign-signature");
  });
});

describe("adapter edge cases", () => {
  it("clones cycles and __proto__ keys without prototype pollution", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    const result = fromOpenAIChatMessages([
      {
        role: "assistant",
        content: [{ type: "future", payload: cyclic }],
      },
    ]);
    const part = result.messages[0]?.parts[0] as {
      data: { payload: Record<string, unknown> };
    };
    expect(part.data.payload.self).toBe(part.data.payload);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(
      Object.prototype.hasOwnProperty.call(part.data.payload, "__proto__"),
    ).toBe(true);
  });

  it("handles OpenAI text arrays, future parts, and invalid roles", () => {
    const result = fromOpenAIChatMessages([
      { role: "system", content: "rules" },
      {
        role: "assistant",
        content: [
          { type: "output_text", text: "done" },
          { type: "image", url: "x" },
        ],
      },
      { role: "alien", content: "bad" },
      null,
    ]);
    expect(result.messages[0]?.parts[0]).toEqual({
      type: "text",
      text: "rules",
    });
    expect(result.messages[1]?.parts.map((part) => part.type)).toEqual([
      "text",
      "provider",
    ]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("handles Anthropic text, errors, and future blocks", () => {
    const result = fromAnthropicMessages([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "visible" },
          { type: "text", text: "" },
          { type: "redacted_thinking", signature: "s" },
          { type: "future_block", value: 1 },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "x",
            content: "failed",
            is_error: true,
          },
        ],
      },
      { role: "system", content: "bad" },
    ]);
    expect(result.messages[0]?.parts[0]).toEqual({
      type: "text",
      text: "hello",
    });
    expect(result.messages[1]?.parts.map((part) => part.type)).toEqual([
      "text",
      "reasoning",
      "provider",
    ]);
    expect(result.messages[2]?.parts[0]).toMatchObject({ isError: true });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("correlates ID-less Gemini calls and responses by name", () => {
    const result = fromGeminiContents(
      [
        {
          role: "model",
          parts: [
            { text: "thinking", thought: true, thoughtSignature: "s" },
            { functionCall: { name: "go", args: {} }, thoughtSignature: "t" },
          ],
        },
        {
          role: "user",
          parts: [{ functionResponse: { name: "go", response: { ok: true } } }],
        },
      ],
      { provider: "vertex" },
    );
    const call = result.messages[0]?.parts[1];
    const response = result.messages[1]?.parts[0];
    expect(call).toMatchObject({ signatureProvider: "vertex" });
    expect(response).toMatchObject({
      type: "tool-result",
      toolCallId: (call as { id: string }).id,
    });
  });

  it("handles Gemini unknown parts and malformed contents", () => {
    const result = fromGeminiContents([
      { role: "model", parts: [null, { inlineData: "x" }] },
      { role: "alien", parts: [] },
      { role: "user" },
    ]);
    expect(result.messages[0]?.parts[0]?.type).toBe("provider");
    expect(result.diagnostics).toHaveLength(2);
  });

  it("handles AI SDK text, reasoning, results, and future parts", () => {
    const result = fromAISDKModelMessages([
      { role: "system", content: "rules" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          { type: "text", text: "" },
          { type: "reasoning", text: "plan", signature: "s" },
          { type: "future", value: 1 },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "x",
            toolName: "go",
            output: "ok",
          },
        ],
      },
      { role: "alien", content: [] },
    ]);
    expect(result.messages[0]?.parts[0]).toEqual({
      type: "text",
      text: "rules",
    });
    expect(result.messages[1]?.parts.map((part) => part.type)).toEqual([
      "text",
      "reasoning",
      "provider",
    ]);
    expect(result.messages[2]?.parts[0]).toMatchObject({ name: "go" });
    expect(result.diagnostics).toHaveLength(1);
  });
});
