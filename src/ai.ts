/**
 * `ai()` — the ONLY way to invoke the LLM path.
 *
 * Rule #2 of the freeze contract: the expensive path is always visible in the
 * source. A code reviewer greps for `ai(` and sees every dollar. A plain string
 * never touches this file and never spends a token.
 */
import {
  NL_EXTRACT,
  NL_TARGET,
  type NLExtract,
  type NLTarget,
  type Schema,
} from "./types.js";

/** Wrap an instruction to resolve an element via the LLM path. */
export function ai(instruction: string): NLTarget;
/** Wrap a schema + instruction to extract structured data via the LLM path. */
export function ai<T>(spec: { schema: Schema<T>; instruction: string }): NLExtract<T>;
export function ai<T>(
  arg: string | { schema: Schema<T>; instruction: string },
): NLTarget | NLExtract<T> {
  if (typeof arg === "string") {
    const instruction = arg.trim();
    if (!instruction) {
      throw new TypeError("ai(): instruction must be a non-empty string.");
    }
    return { [NL_TARGET]: true, instruction };
  }

  if (!arg || typeof arg !== "object") {
    throw new TypeError(
      "ai(): expected a string instruction or { schema, instruction }.",
    );
  }
  const instruction = (arg.instruction ?? "").trim();
  if (!instruction) {
    throw new TypeError("ai(): { instruction } must be a non-empty string.");
  }
  if (!arg.schema || typeof arg.schema.parse !== "function") {
    throw new TypeError(
      "ai(): { schema } must expose a parse(data) method (e.g. a zod schema).",
    );
  }
  return { [NL_EXTRACT]: true, instruction, schema: arg.schema };
}

/** Runtime type guard: is this an ai("...") locate target? */
export function isNLTarget(value: unknown): value is NLTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[NL_TARGET] === true
  );
}

/** Runtime type guard: is this an ai({ schema, instruction }) extract target? */
export function isNLExtract<T = unknown>(value: unknown): value is NLExtract<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[NL_EXTRACT] === true
  );
}
