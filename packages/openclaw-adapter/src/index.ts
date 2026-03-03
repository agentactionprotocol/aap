/**
 * aap-openclaw-adapter
 *
 * Wraps any OpenClaw hook handler with AAP manifest parsing,
 * contract validation, and runtime context injection.
 *
 * Usage:
 *
 *   import { createAAPAdapter } from "@aap/openclaw-adapter";
 *   import handler from "./handler.js";
 *
 *   export default createAAPAdapter(handler, {
 *     hookDir: import.meta.dirname,
 *   });
 */

import { loadManifests, type LoadedManifests } from "./loader.js";
import { validateInputs, validateOutputs } from "./validator.js";
import { resolveRuntimeContext } from "./context.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpenClawHandler = (event: Record<string, unknown>) => Promise<void>;

export interface AAPAdapterOptions {
  /** Directory containing action.aap.yaml, contract.aap.yaml, hooks.aap.yaml */
  hookDir: string;
  /** Called with all warnings. Defaults to console.warn. */
  onWarning?: (warning: string) => void;
}

export interface AAPAdapterResult {
  /** The wrapped handler to export as the OpenClaw hook */
  handler: OpenClawHandler;
  /** The loaded manifests (for inspection/testing) */
  manifests: LoadedManifests;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createAAPAdapter(
  innerHandler: OpenClawHandler,
  options: AAPAdapterOptions
): AAPAdapterResult {
  const warn = options.onWarning ?? ((msg: string) => console.warn(msg));

  // Load and validate manifests at startup (not per-event)
  const manifests = loadManifests(options.hookDir);

  // Emit startup warnings
  for (const w of manifests.warnings) {
    warn(w);
  }

  if (manifests.action) {
    console.log(
      `[aap] Loaded action: ${manifests.action.metadata.name}@${manifests.action.metadata.version}`
    );
  } else {
    warn("[aap] No action.aap.yaml found — running without manifest validation");
  }

  if (manifests.hooks.length > 0) {
    console.log(`[aap] Registered ${manifests.hooks.length} AAP hook(s):`);
    for (const h of manifests.hooks) {
      console.log(`  • ${h.metadata.name} (${h.metadata.type}) → ${h.trigger.event}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Wrapped handler
  // ---------------------------------------------------------------------------

  const handler: OpenClawHandler = async (event) => {
    const eventWarnings: string[] = [];

    // 1. Inject runtime context if action declares it
    if (manifests.action) {
      const { runtime_context, warnings: ctxWarnings } = resolveRuntimeContext(
        manifests.action,
        event
      );
      eventWarnings.push(...ctxWarnings);

      // Attach resolved context to event for downstream use
      event.__aap_runtime_context = runtime_context;
    }

    // 2. Validate inputs against contract
    if (manifests.contract && manifests.contract.input_schema) {
      const result = validateInputs(manifests.contract, event as Record<string, unknown>);
      eventWarnings.push(...result.warnings.map((w) => `[aap:input] ${w}`));
    }

    // 3. Emit pre-execution warnings
    for (const w of eventWarnings) {
      warn(w);
    }

    // 4. Run the real handler — always, regardless of warnings
    await innerHandler(event);

    // 5. Output validation would go here if the handler returned outputs
    // OpenClaw handlers are fire-and-forget (void), so we validate
    // the getStatus() output shape instead at shutdown if available.
  };

  return { handler, manifests };
}

// ---------------------------------------------------------------------------
// Output validator helper — call this on your getStatus() result
// ---------------------------------------------------------------------------

export function validateHandlerStatus(
  manifests: LoadedManifests,
  status: Record<string, unknown>,
  onWarning: (w: string) => void = console.warn
): void {
  if (!manifests.contract) return;
  const result = validateOutputs(manifests.contract, status);
  for (const w of result.warnings) {
    onWarning(w);
  }
}

// Re-export types for consumers
export type { LoadedManifests, AAPActionManifest, AAPContractManifest, AAPHookManifest } from "./loader.js";
