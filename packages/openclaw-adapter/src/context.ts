/**
 * aap-openclaw-adapter — Runtime Context Injector
 *
 * Resolves and injects runtime_context into hook execution
 * based on what OpenClaw's gateway provides.
 */

import type { AAPActionManifest } from "./loader.js";

export interface OpenClawRuntimeContext {
  session_key?: string;
  channel?: string;
  model?: string;
  workspace?: string;
  gateway_config?: Record<string, unknown>;
}

export interface ResolvedContext {
  runtime_context: OpenClawRuntimeContext;
  warnings: string[];
}

/**
 * Resolves runtime_context from the OpenClaw event and environment.
 * Only populates fields declared as optional context in the action manifest.
 */
export function resolveRuntimeContext(
  action: AAPActionManifest,
  event: Record<string, unknown>
): ResolvedContext {
  const warnings: string[] = [];

  // Check if action declares runtime_context as optional context
  const declaresRuntimeContext = action.context?.optional?.some(
    (c) => c.type === "runtime_context"
  );

  if (!declaresRuntimeContext) {
    return { runtime_context: {}, warnings };
  }

  const ctx: OpenClawRuntimeContext = {
    session_key: asString(event.sessionKey),
    channel: asString(event.channel),
    model: asString(event.model),
    workspace: asString(event.workspace),
  };

  // Warn if declared fields are missing from the event
  const declared = action.context?.optional?.find(
    (c) => c.type === "runtime_context"
  );
  if (declared?.fields) {
    for (const field of Object.keys(declared.fields)) {
      if (!(field in ctx) || ctx[field as keyof OpenClawRuntimeContext] === undefined) {
        warnings.push(`[aap] runtime_context.${field} declared but not available from event`);
      }
    }
  }

  return { runtime_context: ctx, warnings };
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}
