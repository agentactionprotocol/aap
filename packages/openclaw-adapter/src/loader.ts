/**
 * aap-openclaw-adapter — Manifest Loader
 *
 * Reads and parses AAP manifest files (action, contract, hooks)
 * from the hook directory. Warns on violations, never aborts.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AAPActionManifest {
  aap: string;
  kind: "Action";
  metadata: {
    name: string;
    version: string;
    author?: string;
    license?: string;
    description?: string;
    tags?: string[];
    runtime_compatibility?: string[];
  };
  context?: {
    required?: AAPContextItem[];
    optional?: AAPContextItem[];
  };
  inputs?: Record<string, AAPInputDef>;
  outputs?: Record<string, AAPOutputDef>;
  execution?: {
    type: "runtime" | "mcp" | "cli" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    timeout_ms?: number;
    sandbox?: boolean;
  };
  permissions?: {
    capabilities?: string[];
    roles?: string[];
  };
  resources?: {
    max_tokens?: number;
    max_latency_ms?: number;
    max_cost_usd?: number;
  };
  hooks?: Record<string, string>;
  state?: {
    checkpoint?: boolean;
    context_keys?: string[];
  };
}

export interface AAPContractManifest {
  aap: string;
  kind: "Contract";
  for: string;
  input_schema?: JSONSchema;
  output_schema?: JSONSchema;
  invariants?: string[];
  resource_limits?: {
    max_tokens?: number;
    max_latency_ms?: number;
    max_cost_usd?: number;
    max_retries?: number;
  };
}

export interface AAPHookManifest {
  aap: string;
  kind: "Hook";
  metadata: {
    name: string;
    version: string;
    type: "observe" | "validation" | "auth" | "transform" | "approval" | "error" | "guard" | "state";
  };
  trigger: {
    event: string;
    condition?: string;
  };
  action: {
    type: string;
    config?: Record<string, unknown>;
  };
}

export interface AAPContextItem {
  type: string;
  formats?: string[];
  max_size?: string;
  max_turns?: number;
  description?: string;
  fields?: Record<string, string>;
}

export interface AAPInputDef {
  type: string;
  default?: unknown;
  description?: string;
  values?: string[];
  range?: [number, number];
  unit?: string;
}

export interface AAPOutputDef {
  type: string;
  description?: string;
  values?: string[];
}

export type JSONSchema = Record<string, unknown>;

export interface LoadedManifests {
  action: AAPActionManifest | null;
  contract: AAPContractManifest | null;
  hooks: AAPHookManifest[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadManifests(hookDir: string): LoadedManifests {
  const warnings: string[] = [];

  const action = loadYAML<AAPActionManifest>(
    join(hookDir, "action.aap.yaml"),
    warnings,
    validateActionManifest
  );

  const contract = loadYAML<AAPContractManifest>(
    join(hookDir, "contract.aap.yaml"),
    warnings,
    validateContractManifest
  );

  const hooks = loadHooks(join(hookDir, "hooks.aap.yaml"), warnings);

  // Cross-validate contract references action
  if (action && contract) {
    const expected = `${action.metadata.name}@${action.metadata.version}`;
    if (contract.for !== expected) {
      warnings.push(
        `[aap] contract.for="${contract.for}" does not match action "${expected}"`
      );
    }
  }

  return { action, contract, hooks, warnings };
}

function loadYAML<T>(
  path: string,
  warnings: string[],
  validator: (doc: unknown, warnings: string[]) => T | null
): T | null {
  if (!existsSync(path)) {
    // Not all hooks need every manifest — not a warning
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const doc = parse(raw);
    return validator(doc, warnings);
  } catch (err) {
    warnings.push(`[aap] Failed to parse ${path}: ${String(err)}`);
    return null;
  }
}

function loadHooks(path: string, warnings: string[]): AAPHookManifest[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    // hooks.aap.yaml is multi-document YAML
    const docs = raw
      .split(/^---$/m)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        try { return parse(s); } catch { return null; }
      })
      .filter(Boolean);

    const hooks: AAPHookManifest[] = [];
    for (const doc of docs) {
      const hook = validateHookManifest(doc, warnings);
      if (hook) hooks.push(hook);
    }
    return hooks;
  } catch (err) {
    warnings.push(`[aap] Failed to parse ${path}: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Validators — warn, never throw
// ---------------------------------------------------------------------------

function validateActionManifest(
  doc: unknown,
  warnings: string[]
): AAPActionManifest | null {
  if (!doc || typeof doc !== "object") {
    warnings.push("[aap] action.aap.yaml: not a valid object");
    return null;
  }
  const d = doc as Record<string, unknown>;

  if (d.kind !== "Action") {
    warnings.push(`[aap] action.aap.yaml: kind must be "Action", got "${d.kind}"`);
  }
  if (!d.aap || typeof d.aap !== "string") {
    warnings.push("[aap] action.aap.yaml: missing aap version field");
  }
  if (!d.metadata || typeof d.metadata !== "object") {
    warnings.push("[aap] action.aap.yaml: missing metadata block");
    return null;
  }

  const meta = d.metadata as Record<string, unknown>;
  if (!meta.name) warnings.push("[aap] action.aap.yaml: metadata.name is required");
  if (!meta.version) warnings.push("[aap] action.aap.yaml: metadata.version is required");

  return doc as AAPActionManifest;
}

function validateContractManifest(
  doc: unknown,
  warnings: string[]
): AAPContractManifest | null {
  if (!doc || typeof doc !== "object") {
    warnings.push("[aap] contract.aap.yaml: not a valid object");
    return null;
  }
  const d = doc as Record<string, unknown>;

  if (d.kind !== "Contract") {
    warnings.push(`[aap] contract.aap.yaml: kind must be "Contract", got "${d.kind}"`);
  }
  if (!d.for) {
    warnings.push('[aap] contract.aap.yaml: "for" field is required');
  }
  if (!d.output_schema) {
    warnings.push("[aap] contract.aap.yaml: output_schema is missing — outputs will not be validated");
  }

  return doc as AAPContractManifest;
}

function validateHookManifest(
  doc: unknown,
  warnings: string[]
): AAPHookManifest | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;

  if (d.kind !== "Hook") return null; // skip non-hook docs silently

  const meta = d.metadata as Record<string, unknown> | undefined;
  if (!meta?.name) {
    warnings.push("[aap] hooks.aap.yaml: a hook is missing metadata.name");
  }
  if (!meta?.type) {
    warnings.push(`[aap] hook "${meta?.name}": missing metadata.type`);
  }
  if (!d.trigger) {
    warnings.push(`[aap] hook "${meta?.name}": missing trigger block`);
  }
  if (!d.action) {
    warnings.push(`[aap] hook "${meta?.name}": missing action block`);
  }

  return doc as AAPHookManifest;
}
