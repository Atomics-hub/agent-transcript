import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { auditTranscript } from "../src/index.js";

describe("graph properties", () => {
  it("accepts arbitrarily sized uniquely paired tool graphs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), {
          minLength: 1,
          maxLength: 100,
        }),
        (ids) => {
          const result = auditTranscript([
            {
              role: "assistant",
              parts: ids.map((id) => ({
                type: "tool-call",
                id,
                name: "tool",
                input: {},
              })),
            },
            {
              role: "tool",
              parts: ids.map((id) => ({
                type: "tool-result",
                toolCallId: id,
                output: null,
              })),
            },
          ]);
          expect(result.replayable).toBe(true);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("always rejects an orphan result", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        const result = auditTranscript([
          {
            role: "tool",
            parts: [{ type: "tool-result", toolCallId: id, output: null }],
          },
        ]);
        expect(result.replayable).toBe(false);
        expect(result.diagnostics[0]?.code).toBe("orphan-tool-result");
      }),
      { numRuns: 500 },
    );
  });
});
