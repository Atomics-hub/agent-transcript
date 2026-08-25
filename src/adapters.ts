import { clone, isRecord, nonEmptyText, parseJsonOrText } from "./internal.js";
import type {
  GeminiAdapterOptions,
  TranscriptAdapterResult,
  TranscriptDiagnostic,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole,
} from "./types.js";

function adapterDiagnostic(
  message: string,
  path: string,
): TranscriptDiagnostic {
  return {
    code: "invalid-message",
    severity: "error",
    message,
    path,
    repaired: false,
  };
}

function arrayInput(
  input: unknown,
  diagnostics: TranscriptDiagnostic[],
): readonly unknown[] {
  if (Array.isArray(input)) return input;
  diagnostics.push(
    adapterDiagnostic("Provider messages must be an array", "messages"),
  );
  return [];
}

function role(
  value: unknown,
  mapping: Record<string, TranscriptRole>,
): TranscriptRole | undefined {
  return typeof value === "string" ? mapping[value] : undefined;
}

function contentText(value: unknown): TranscriptPart[] {
  const text = nonEmptyText(value);
  return text === undefined ? [] : [{ type: "text", text }];
}

/** Convert OpenAI Chat Completions messages into the canonical transcript graph. */
export function fromOpenAIChatMessages(
  input: unknown,
): TranscriptAdapterResult {
  const diagnostics: TranscriptDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
  const mapping: Record<string, TranscriptRole> = {
    system: "system",
    developer: "developer",
    user: "user",
    assistant: "assistant",
    tool: "tool",
  };

  arrayInput(input, diagnostics).forEach((value, index) => {
    if (!isRecord(value)) {
      diagnostics.push(
        adapterDiagnostic(
          "OpenAI message must be an object",
          `messages[${String(index)}]`,
        ),
      );
      return;
    }
    const messageRole = role(value.role, mapping);
    if (messageRole === undefined) {
      diagnostics.push(
        adapterDiagnostic(
          "Unsupported OpenAI message role",
          `messages[${String(index)}].role`,
        ),
      );
      return;
    }
    const parts: TranscriptPart[] =
      messageRole === "tool" ? [] : contentText(value.content);
    if (messageRole !== "tool" && Array.isArray(value.content)) {
      for (const item of value.content) {
        if (!isRecord(item)) continue;
        if (
          item.type === "text" ||
          item.type === "input_text" ||
          item.type === "output_text"
        ) {
          const text = nonEmptyText(item.text);
          if (text !== undefined) parts.push({ type: "text", text });
        } else {
          parts.push({
            type: "provider",
            provider: "openai",
            kind: String(item.type),
            data: clone(item),
          });
        }
      }
    }
    if (messageRole === "assistant" && Array.isArray(value.tool_calls)) {
      for (const toolCallValue of value.tool_calls) {
        const toolCall = isRecord(toolCallValue) ? toolCallValue : {};
        const fn = isRecord(toolCall.function) ? toolCall.function : {};
        parts.push({
          type: "tool-call",
          id: typeof toolCall.id === "string" ? toolCall.id : "",
          name: typeof fn.name === "string" ? fn.name : "",
          input: parseJsonOrText(fn.arguments),
        });
      }
    }
    if (messageRole === "tool") {
      parts.push({
        type: "tool-result",
        toolCallId:
          typeof value.tool_call_id === "string" ? value.tool_call_id : "",
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        output: clone(value.content),
      });
    }
    messages.push({ role: messageRole, parts, provider: "openai" });
  });
  return { messages, diagnostics };
}

/** Convert Anthropic Messages API history into the canonical transcript graph. */
export function fromAnthropicMessages(input: unknown): TranscriptAdapterResult {
  const diagnostics: TranscriptDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
  const mapping: Record<string, TranscriptRole> = {
    user: "user",
    assistant: "assistant",
  };

  arrayInput(input, diagnostics).forEach((value, index) => {
    if (!isRecord(value)) {
      diagnostics.push(
        adapterDiagnostic(
          "Anthropic message must be an object",
          `messages[${String(index)}]`,
        ),
      );
      return;
    }
    const messageRole = role(value.role, mapping);
    if (messageRole === undefined) {
      diagnostics.push(
        adapterDiagnostic(
          "Unsupported Anthropic message role",
          `messages[${String(index)}].role`,
        ),
      );
      return;
    }
    const parts: TranscriptPart[] = contentText(value.content);
    if (Array.isArray(value.content)) {
      for (const blockValue of value.content) {
        if (!isRecord(blockValue)) continue;
        if (blockValue.type === "text") {
          const text = nonEmptyText(blockValue.text);
          if (text !== undefined) parts.push({ type: "text", text });
        } else if (
          blockValue.type === "thinking" ||
          blockValue.type === "redacted_thinking"
        ) {
          parts.push({
            type: "reasoning",
            ...(typeof blockValue.thinking === "string"
              ? { text: blockValue.thinking }
              : {}),
            ...(typeof blockValue.signature === "string"
              ? { signature: blockValue.signature }
              : {}),
            signatureProvider: "anthropic",
          });
        } else if (
          blockValue.type === "tool_use" ||
          blockValue.type === "server_tool_use"
        ) {
          const caller = isRecord(blockValue.caller)
            ? blockValue.caller
            : undefined;
          parts.push({
            type: "tool-call",
            id: typeof blockValue.id === "string" ? blockValue.id : "",
            name: typeof blockValue.name === "string" ? blockValue.name : "",
            input: clone(blockValue.input),
            ...(typeof caller?.tool_id === "string"
              ? { callerId: caller.tool_id }
              : {}),
          });
        } else if (
          blockValue.type === "tool_result" ||
          blockValue.type === "web_search_tool_result"
        ) {
          parts.push({
            type: "tool-result",
            toolCallId:
              typeof blockValue.tool_use_id === "string"
                ? blockValue.tool_use_id
                : typeof blockValue.toolUseId === "string"
                  ? blockValue.toolUseId
                  : "",
            output: clone(blockValue.content),
            ...(blockValue.is_error === true ? { isError: true } : {}),
          });
        } else {
          parts.push({
            type: "provider",
            provider: "anthropic",
            kind: String(blockValue.type),
            data: clone(blockValue),
          });
        }
      }
    }
    messages.push({ role: messageRole, parts, provider: "anthropic" });
  });
  return { messages, diagnostics };
}

/** Convert Gemini `contents` into the canonical transcript graph. */
export function fromGeminiContents(
  input: unknown,
  options: GeminiAdapterOptions = {},
): TranscriptAdapterResult {
  const diagnostics: TranscriptDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
  const provider = options.provider ?? "google";
  const pendingByName = new Map<string, string[]>();
  const mapping: Record<string, TranscriptRole> = {
    model: "assistant",
    user: "user",
  };

  arrayInput(input, diagnostics).forEach((value, index) => {
    if (!isRecord(value)) {
      diagnostics.push(
        adapterDiagnostic(
          "Gemini content must be an object",
          `messages[${String(index)}]`,
        ),
      );
      return;
    }
    const messageRole = role(value.role, mapping);
    if (messageRole === undefined || !Array.isArray(value.parts)) {
      diagnostics.push(
        adapterDiagnostic(
          "Gemini content requires model/user role and parts",
          `messages[${String(index)}]`,
        ),
      );
      return;
    }
    const parts: TranscriptPart[] = [];
    const groupId = `gemini-turn-${String(index)}`;
    value.parts.forEach((partValue, partIndex) => {
      if (!isRecord(partValue)) return;
      const text = nonEmptyText(partValue.text);
      if (text !== undefined) {
        parts.push(
          partValue.thought === true
            ? {
                type: "reasoning",
                text,
                ...(typeof partValue.thoughtSignature === "string"
                  ? { signature: partValue.thoughtSignature }
                  : {}),
                signatureProvider: provider,
              }
            : { type: "text", text },
        );
      } else if (isRecord(partValue.functionCall)) {
        const fn = partValue.functionCall;
        const name = typeof fn.name === "string" ? fn.name : "";
        const id =
          typeof fn.id === "string"
            ? fn.id
            : `${groupId}-${String(partIndex)}-${name}`;
        if (name !== "") {
          const pending = pendingByName.get(name) ?? [];
          pending.push(id);
          pendingByName.set(name, pending);
        }
        parts.push({
          type: "tool-call",
          id,
          name,
          input: clone(fn.args),
          groupId,
          ...(typeof partValue.thoughtSignature === "string"
            ? { signature: partValue.thoughtSignature }
            : {}),
          signatureProvider: provider,
        });
      } else if (isRecord(partValue.functionResponse)) {
        const response = partValue.functionResponse;
        const name = typeof response.name === "string" ? response.name : "";
        const inferredId = pendingByName.get(name)?.shift();
        parts.push({
          type: "tool-result",
          toolCallId:
            typeof response.id === "string"
              ? response.id
              : (inferredId ?? name),
          ...(name === "" ? {} : { name }),
          output: clone(response.response),
        });
      } else {
        parts.push({
          type: "provider",
          provider,
          kind: "part",
          data: clone(partValue),
        });
      }
    });
    messages.push({ role: messageRole, parts, provider });
  });
  return { messages, diagnostics };
}

/** Convert Vercel AI SDK ModelMessage-shaped history without importing AI SDK types. */
export function fromAISDKModelMessages(
  input: unknown,
): TranscriptAdapterResult {
  const diagnostics: TranscriptDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
  const mapping: Record<string, TranscriptRole> = {
    system: "system",
    user: "user",
    assistant: "assistant",
    tool: "tool",
  };

  arrayInput(input, diagnostics).forEach((value, index) => {
    if (!isRecord(value)) {
      diagnostics.push(
        adapterDiagnostic(
          "AI SDK message must be an object",
          `messages[${String(index)}]`,
        ),
      );
      return;
    }
    const messageRole = role(value.role, mapping);
    if (messageRole === undefined) {
      diagnostics.push(
        adapterDiagnostic(
          "Unsupported AI SDK message role",
          `messages[${String(index)}].role`,
        ),
      );
      return;
    }
    const parts: TranscriptPart[] = contentText(value.content);
    if (Array.isArray(value.content)) {
      for (const partValue of value.content) {
        if (!isRecord(partValue)) continue;
        if (partValue.type === "text") {
          const text = nonEmptyText(partValue.text);
          if (text !== undefined) parts.push({ type: "text", text });
        } else if (partValue.type === "reasoning") {
          parts.push({
            type: "reasoning",
            ...(typeof partValue.text === "string"
              ? { text: partValue.text }
              : {}),
            ...(typeof partValue.signature === "string"
              ? { signature: partValue.signature }
              : {}),
          });
        } else if (partValue.type === "tool-call") {
          const providerOptions = isRecord(partValue.providerOptions)
            ? partValue.providerOptions
            : undefined;
          const anthropic = isRecord(providerOptions?.anthropic)
            ? providerOptions.anthropic
            : undefined;
          const caller =
            isRecord(anthropic) && isRecord(anthropic.caller)
              ? anthropic.caller
              : undefined;
          parts.push({
            type: "tool-call",
            id:
              typeof partValue.toolCallId === "string"
                ? partValue.toolCallId
                : "",
            name:
              typeof partValue.toolName === "string" ? partValue.toolName : "",
            input: clone(partValue.input),
            ...(typeof caller?.toolId === "string"
              ? { callerId: caller.toolId }
              : {}),
          });
        } else if (partValue.type === "tool-result") {
          parts.push({
            type: "tool-result",
            toolCallId:
              typeof partValue.toolCallId === "string"
                ? partValue.toolCallId
                : "",
            ...(typeof partValue.toolName === "string"
              ? { name: partValue.toolName }
              : {}),
            output: clone(partValue.output),
          });
        } else {
          parts.push({
            type: "provider",
            provider: "ai-sdk",
            kind: String(partValue.type),
            data: clone(partValue),
          });
        }
      }
    }
    messages.push({ role: messageRole, parts, provider: "ai-sdk" });
  });
  return { messages, diagnostics };
}
