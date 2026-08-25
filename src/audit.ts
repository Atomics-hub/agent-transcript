import { clone, isRecord, path } from "./internal.js";
import type {
  AuditTranscriptOptions,
  ToolCallPart,
  TranscriptAuditResult,
  TranscriptDiagnostic,
  TranscriptDiagnosticCode,
  TranscriptPart,
  TranscriptRole,
} from "./types.js";

type MutableMessage = {
  role: TranscriptRole;
  parts: TranscriptPart[];
  id?: string;
  provider?: string;
};

type CallState = {
  call: ToolCallPart;
  path: string;
  messageIndex: number;
  resultPath?: string;
};

const roles = new Set<TranscriptRole>([
  "system",
  "developer",
  "user",
  "assistant",
  "tool",
]);

function diagnostic(
  code: TranscriptDiagnosticCode,
  message: string,
  diagnosticPath: string,
  severity: TranscriptDiagnostic["severity"] = "error",
  repaired = false,
  relatedPath?: string,
): TranscriptDiagnostic {
  return {
    code,
    message,
    path: diagnosticPath,
    severity,
    repaired,
    ...(relatedPath === undefined ? {} : { relatedPath }),
  };
}

function isToolCall(part: TranscriptPart): part is ToolCallPart {
  return part.type === "tool-call";
}

function signatureProviderForTarget(target: string): string | undefined {
  if (target === "gemini" || target === "gemini-thinking") return "google";
  if (target === "vertex-gemini") return "vertex";
  return undefined;
}

function normalizeMessages(
  input: unknown,
  diagnostics: TranscriptDiagnostic[],
  maxMessages: number,
  maxParts: number,
): MutableMessage[] {
  if (!Array.isArray(input)) {
    diagnostics.push(
      diagnostic("invalid-message", "Transcript must be an array", "messages"),
    );
    return [];
  }
  const output: MutableMessage[] = [];
  if (input.length > maxMessages) {
    diagnostics.push(
      diagnostic(
        "limit-exceeded",
        `Transcript exceeds the ${String(maxMessages)}-message limit`,
        "messages",
      ),
    );
  }
  let retainedParts = 0;
  input.slice(0, maxMessages).forEach((value, index) => {
    if (
      !isRecord(value) ||
      !roles.has(value.role as TranscriptRole) ||
      !Array.isArray(value.parts)
    ) {
      diagnostics.push(
        diagnostic(
          isRecord(value) && !roles.has(value.role as TranscriptRole)
            ? "invalid-role"
            : "invalid-message",
          "Message must contain a supported role and a parts array",
          path(index),
        ),
      );
      return;
    }
    const remainingParts = maxParts - retainedParts;
    if (value.parts.length > remainingParts) {
      diagnostics.push(
        diagnostic(
          "limit-exceeded",
          `Transcript exceeds the ${String(maxParts)}-part limit`,
          path(index),
        ),
      );
    }
    const parts = value.parts.slice(0, Math.max(0, remainingParts));
    retainedParts += parts.length;
    output.push({
      role: value.role as TranscriptRole,
      parts: clone(parts) as TranscriptPart[],
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.provider === "string"
        ? { provider: value.provider }
        : {}),
    });
  });
  return output;
}

/** Audit a canonical agent transcript and optionally apply only deterministic repairs. */
export function auditTranscript(
  input: unknown,
  options: AuditTranscriptOptions = {},
): TranscriptAuditResult {
  const target = options.target ?? "generic";
  const repair = options.repair ?? "none";
  const maxMessages = options.maxMessages ?? 10_000;
  const maxParts = options.maxParts ?? 100_000;
  if (
    !Number.isSafeInteger(maxMessages) ||
    maxMessages < 0 ||
    !Number.isSafeInteger(maxParts) ||
    maxParts < 0
  ) {
    throw new RangeError(
      "maxMessages and maxParts must be non-negative safe integers",
    );
  }
  const diagnostics: TranscriptDiagnostic[] = [];
  const messages = normalizeMessages(input, diagnostics, maxMessages, maxParts);
  const calls = new Map<string, CallState>();
  const splitGroups = new Map<string, { messageIndex: number; path: string }>();
  const targetSignatureProvider = signatureProviderForTarget(target);
  let changed =
    messages.length !== (Array.isArray(input) ? input.length : 0) ||
    diagnostics.some((item) => item.code === "limit-exceeded");

  messages.forEach((message, messageIndex) => {
    const retained: TranscriptPart[] = [];
    let sawNonResult = false;
    let assistantSubstantive = false;
    const messagePath = path(messageIndex);

    message.parts.forEach((part, partIndex) => {
      const partPath = path(messageIndex, partIndex);
      if (!isRecord(part) || typeof part.type !== "string") {
        diagnostics.push(
          diagnostic(
            "invalid-message",
            "Content part must be an object with a type",
            partPath,
          ),
        );
        retained.push(part);
        return;
      }

      if (part.type === "text") {
        if (typeof part.text !== "string" || part.text === "") {
          const repaired = repair === "safe";
          diagnostics.push(
            diagnostic(
              "empty-text",
              "Empty text content has no replay value",
              partPath,
              "warning",
              repaired,
            ),
          );
          if (repaired) {
            changed = true;
            return;
          }
        } else assistantSubstantive = true;
        sawNonResult = true;
      } else if (part.type === "reasoning") {
        assistantSubstantive = true;
        sawNonResult = true;
        if (
          targetSignatureProvider !== undefined &&
          typeof part.signature === "string" &&
          typeof part.signatureProvider === "string" &&
          part.signatureProvider !== targetSignatureProvider
        ) {
          diagnostics.push(
            diagnostic(
              "foreign-signature",
              `A ${part.signatureProvider} reasoning signature cannot be replayed to ${target}`,
              partPath,
            ),
          );
        }
      } else if (part.type === "tool-call") {
        assistantSubstantive = true;
        sawNonResult = true;
        const id = typeof part.id === "string" ? part.id.trim() : "";
        const name = typeof part.name === "string" ? part.name.trim() : "";
        if (id === "" || name === "") {
          diagnostics.push(
            diagnostic(
              "invalid-message",
              "Tool calls require non-empty id and name",
              partPath,
            ),
          );
        } else if (calls.has(id)) {
          diagnostics.push(
            diagnostic(
              "duplicate-tool-call",
              `Tool call ID ${JSON.stringify(id)} was already used`,
              partPath,
              "error",
              false,
              calls.get(id)?.path,
            ),
          );
        } else {
          calls.set(id, {
            call: part,
            path: partPath,
            messageIndex,
          });
        }

        if (!isRecord(part.input)) {
          const repaired = repair === "safe";
          diagnostics.push(
            diagnostic(
              "invalid-tool-input",
              "Tool-call input must be a JSON object for portable replay",
              partPath,
              "error",
              repaired,
            ),
          );
          if (repaired) {
            (part as { input: unknown }).input = {};
            changed = true;
          }
        }

        if (typeof part.callerId === "string" && !calls.has(part.callerId)) {
          diagnostics.push(
            diagnostic(
              "caller-reference-orphaned",
              `Caller tool ${JSON.stringify(part.callerId)} is missing from earlier history`,
              partPath,
            ),
          );
        }

        if (typeof part.groupId === "string") {
          const previous = splitGroups.get(part.groupId);
          if (
            previous !== undefined &&
            previous.messageIndex !== messageIndex
          ) {
            diagnostics.push(
              diagnostic(
                "parallel-group-split",
                `Parallel tool group ${JSON.stringify(part.groupId)} was split across messages`,
                partPath,
                "error",
                false,
                previous.path,
              ),
            );
          } else if (previous === undefined) {
            splitGroups.set(part.groupId, { messageIndex, path: partPath });
          }
        }

        if (
          target === "gemini-thinking" &&
          !message.parts.slice(0, partIndex).some(isToolCall) &&
          (typeof part.signature !== "string" || part.signature === "")
        ) {
          diagnostics.push(
            diagnostic(
              "missing-thought-signature",
              "The first Gemini function call in a model turn requires a thought signature",
              partPath,
            ),
          );
        }
        if (
          targetSignatureProvider !== undefined &&
          typeof part.signature === "string" &&
          typeof part.signatureProvider === "string" &&
          part.signatureProvider !== targetSignatureProvider
        ) {
          diagnostics.push(
            diagnostic(
              "foreign-signature",
              `A ${part.signatureProvider} function-call signature cannot be replayed to ${target}`,
              partPath,
            ),
          );
        }
      } else if (part.type === "tool-result") {
        const roleInvalid =
          target === "openai-chat" || target === "openai-responses"
            ? message.role !== "tool"
            : target === "anthropic" ||
                target === "gemini" ||
                target === "gemini-thinking" ||
                target === "vertex-gemini"
              ? message.role !== "user"
              : message.role !== "tool" && message.role !== "user";
        if (roleInvalid) {
          diagnostics.push(
            diagnostic(
              "tool-result-role",
              "Tool results must be carried by a tool or user message",
              partPath,
            ),
          );
        }
        if (target === "anthropic" && sawNonResult) {
          diagnostics.push(
            diagnostic(
              "tool-result-order",
              "Anthropic tool_result blocks must precede text in the user message",
              partPath,
            ),
          );
        }
        const toolCallId =
          typeof part.toolCallId === "string" ? part.toolCallId.trim() : "";
        const state = calls.get(toolCallId);
        if (state === undefined) {
          diagnostics.push(
            diagnostic(
              "orphan-tool-result",
              `No earlier tool call has ID ${JSON.stringify(toolCallId)}`,
              partPath,
            ),
          );
        } else if (state.resultPath !== undefined) {
          diagnostics.push(
            diagnostic(
              "duplicate-tool-result",
              `Tool call ${JSON.stringify(toolCallId)} already has a result`,
              partPath,
              "error",
              false,
              state.resultPath,
            ),
          );
        } else {
          state.resultPath = partPath;
          if (typeof part.name === "string" && part.name !== state.call.name) {
            diagnostics.push(
              diagnostic(
                "tool-name-mismatch",
                `Result name ${JSON.stringify(part.name)} does not match call name ${JSON.stringify(state.call.name)}`,
                partPath,
                "error",
                false,
                state.path,
              ),
            );
          } else if (part.name === undefined && repair === "safe") {
            (part as { name?: string }).name = state.call.name;
            diagnostics.push(
              diagnostic(
                "tool-name-mismatch",
                `Filled result name from tool call ${JSON.stringify(state.call.name)}`,
                partPath,
                "warning",
                true,
                state.path,
              ),
            );
            changed = true;
          }
        }
      } else {
        sawNonResult = true;
        assistantSubstantive = true;
      }
      retained.push(part);
    });

    if (repair === "safe" && retained.length !== message.parts.length) {
      message.parts = retained;
    }
    if (message.role === "assistant" && !assistantSubstantive) {
      diagnostics.push(
        diagnostic(
          "empty-assistant",
          "Assistant message contains no replayable content",
          messagePath,
          "error",
        ),
      );
    }
  });

  for (const state of calls.values()) {
    if (state.resultPath === undefined) {
      const atTail = state.messageIndex === messages.length - 1;
      diagnostics.push(
        diagnostic(
          "missing-tool-result",
          `Tool call ${JSON.stringify(state.call.id)} has no matching result`,
          state.path,
          options.allowIncompleteTail === true && atTail ? "warning" : "error",
        ),
      );
    }
  }

  const unrepairedErrors = diagnostics.some(
    (item) => item.severity === "error" && !item.repaired,
  );
  return {
    value: messages,
    diagnostics,
    valid: !unrepairedErrors,
    replayable: !unrepairedErrors,
    changed,
  };
}
