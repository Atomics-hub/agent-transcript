import { describe, expect, it } from "vitest";
import { auditTranscript } from "../src/index.js";

describe("auditTranscript", () => {
  it("accepts a paired parallel tool turn", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            id: "a",
            name: "weather",
            input: { city: "Paris" },
          },
          { type: "tool-call", id: "b", name: "search", input: { q: "AI" } },
        ],
      },
      {
        role: "tool",
        parts: [
          { type: "tool-result", toolCallId: "a", name: "weather", output: 20 },
          { type: "tool-result", toolCallId: "b", name: "search", output: [] },
        ],
      },
    ]);
    expect(result.replayable).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("finds duplicate calls and results", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          { type: "tool-call", id: "x", name: "one", input: {} },
          { type: "tool-call", id: "x", name: "two", input: {} },
        ],
      },
      {
        role: "tool",
        parts: [
          { type: "tool-result", toolCallId: "x", output: 1 },
          { type: "tool-result", toolCallId: "x", output: 2 },
        ],
      },
    ]);
    expect(result.replayable).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "duplicate-tool-call",
      "duplicate-tool-result",
    ]);
  });

  it("detects orphaned caller dependencies after pruning", () => {
    const result = auditTranscript([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            id: "child",
            name: "lookup",
            input: {},
            callerId: "removed-parent",
          },
        ],
      },
      {
        role: "tool",
        parts: [{ type: "tool-result", toolCallId: "child", output: {} }],
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe("caller-reference-orphaned");
  });

  it("detects split Gemini parallel groups and missing signatures", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              id: "a",
              name: "one",
              input: {},
              groupId: "g",
            },
          ],
        },
        {
          role: "assistant",
          parts: [
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
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "parallel-group-split",
    );
    expect(
      result.diagnostics.filter(
        (item) => item.code === "missing-thought-signature",
      ),
    ).toHaveLength(2);
  });

  it("rejects signatures from a different provider surface", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              id: "x",
              name: "go",
              input: {},
              signature: "signed",
              signatureProvider: "google",
            },
          ],
        },
      ],
      { target: "vertex-gemini", allowIncompleteTail: true },
    );
    expect(
      result.diagnostics.some((item) => item.code === "foreign-signature"),
    ).toBe(true);
  });

  it("enforces Anthropic tool-result block ordering", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [{ type: "tool-call", id: "x", name: "go", input: {} }],
        },
        {
          role: "user",
          parts: [
            { type: "text", text: "extra" },
            { type: "tool-result", toolCallId: "x", output: {} },
          ],
        },
      ],
      { target: "anthropic" },
    );
    expect(result.diagnostics[0]?.code).toBe("tool-result-order");
  });

  it("applies deterministic repairs and journals them", () => {
    const result = auditTranscript(
      [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "" },
            { type: "tool-call", id: "x", name: "go", input: "broken" },
          ],
        },
        {
          role: "tool",
          parts: [{ type: "tool-result", toolCallId: "x", output: 1 }],
        },
      ],
      { repair: "safe" },
    );
    expect(result.replayable).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.value[0]?.parts).toEqual([
      { type: "tool-call", id: "x", name: "go", input: {} },
    ]);
    expect(result.value[1]?.parts[0]).toMatchObject({ name: "go" });
    expect(result.diagnostics.every((item) => item.repaired)).toBe(true);
  });

  it("reports malformed messages and incomplete tails", () => {
    expect(auditTranscript({}).diagnostics[0]?.code).toBe("invalid-message");
    const result = auditTranscript(
      [
        null,
        { role: "alien", parts: [] },
        {
          role: "assistant",
          parts: [{ type: "tool-call", id: "x", name: "go", input: {} }],
        },
      ],
      { allowIncompleteTail: true },
    );
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "invalid-message",
      "invalid-role",
      "missing-tool-result",
    ]);
    expect(result.diagnostics[2]?.severity).toBe("warning");
  });

  it("bounds message and part work", () => {
    const messages = auditTranscript(
      [
        { role: "system", parts: [{ type: "text", text: "one" }] },
        { role: "user", parts: [{ type: "text", text: "two" }] },
      ],
      { maxMessages: 1 },
    );
    expect(messages.changed).toBe(true);
    expect(messages.diagnostics[0]?.code).toBe("limit-exceeded");

    const parts = auditTranscript(
      [
        {
          role: "system",
          parts: [
            { type: "text", text: "one" },
            { type: "text", text: "two" },
          ],
        },
      ],
      { maxParts: 1 },
    );
    expect(parts.value[0]?.parts).toHaveLength(1);
    expect(parts.diagnostics[0]?.code).toBe("limit-exceeded");
    expect(() => auditTranscript([], { maxParts: -1 })).toThrow(RangeError);
  });
});
