export type TranscriptTarget =
  | "generic"
  | "openai-chat"
  | "openai-responses"
  | "anthropic"
  | "gemini"
  | "gemini-thinking"
  | "vertex-gemini";

export type TranscriptRole =
  "system" | "developer" | "user" | "assistant" | "tool";

export type TextPart = {
  readonly type: "text";
  readonly text: string;
};

export type ReasoningPart = {
  readonly type: "reasoning";
  readonly text?: string;
  readonly signature?: string;
  readonly signatureProvider?: string;
};

export type ToolCallPart = {
  readonly type: "tool-call";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly groupId?: string;
  readonly callerId?: string;
  readonly signature?: string;
  readonly signatureProvider?: string;
};

export type ToolResultPart = {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly name?: string;
  readonly output: unknown;
  readonly isError?: boolean;
};

export type ProviderPart = {
  readonly type: "provider";
  readonly provider: string;
  readonly kind: string;
  readonly data: unknown;
};

export type TranscriptPart =
  TextPart | ReasoningPart | ToolCallPart | ToolResultPart | ProviderPart;

export type TranscriptMessage = {
  readonly role: TranscriptRole;
  readonly parts: readonly TranscriptPart[];
  readonly id?: string;
  readonly provider?: string;
};

export type TranscriptDiagnosticCode =
  | "caller-reference-orphaned"
  | "duplicate-tool-call"
  | "duplicate-tool-result"
  | "empty-assistant"
  | "empty-text"
  | "foreign-signature"
  | "invalid-message"
  | "invalid-role"
  | "invalid-tool-input"
  | "limit-exceeded"
  | "missing-thought-signature"
  | "missing-tool-result"
  | "orphan-tool-result"
  | "parallel-group-split"
  | "tool-name-mismatch"
  | "tool-result-order"
  | "tool-result-role";

export type TranscriptDiagnostic = {
  readonly code: TranscriptDiagnosticCode;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly path: string;
  readonly repaired: boolean;
  readonly relatedPath?: string;
};

export type AuditTranscriptOptions = {
  readonly target?: TranscriptTarget;
  readonly repair?: "none" | "safe";
  readonly allowIncompleteTail?: boolean;
  readonly maxMessages?: number;
  readonly maxParts?: number;
};

export type TranscriptAuditResult = {
  readonly value: readonly TranscriptMessage[];
  readonly diagnostics: readonly TranscriptDiagnostic[];
  readonly valid: boolean;
  readonly replayable: boolean;
  readonly changed: boolean;
};

export type TranscriptAdapterResult = {
  readonly messages: readonly TranscriptMessage[];
  readonly diagnostics: readonly TranscriptDiagnostic[];
};

export type GeminiAdapterOptions = {
  readonly provider?: "google" | "vertex";
};
