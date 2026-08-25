export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function clone(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown {
  if (typeof value === "object" && value !== null) {
    const existing = seen.get(value);
    if (existing !== undefined) return existing;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(clone(item, seen));
    return result;
  }
  if (isRecord(value)) {
    const result: UnknownRecord = {};
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        value: clone(item, seen),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  return value;
}

export function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function path(messageIndex: number, partIndex?: number): string {
  return partIndex === undefined
    ? `messages[${String(messageIndex)}]`
    : `messages[${String(messageIndex)}].parts[${String(partIndex)}]`;
}

export function parseJsonOrText(value: unknown): unknown {
  if (typeof value !== "string") return clone(value);
  if (value.trim() === "") return "";
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
