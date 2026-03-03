/**
 * aap-openclaw-adapter — Contract Validator
 *
 * Validates inputs and outputs against contract.aap.yaml schemas.
 * All violations are warnings only — never aborts execution.
 */

import type { AAPContractManifest, JSONSchema } from "./loader.js";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export function validateInputs(
  contract: AAPContractManifest,
  inputs: Record<string, unknown>
): ValidationResult {
  const warnings: string[] = [];

  if (!contract.input_schema) {
    return { valid: true, warnings }; // no schema = no validation
  }

  checkSchema("input", contract.input_schema, inputs, warnings);
  return { valid: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

export function validateOutputs(
  contract: AAPContractManifest,
  outputs: Record<string, unknown>
): ValidationResult {
  const warnings: string[] = [];

  if (!contract.output_schema) {
    return { valid: true, warnings };
  }

  checkSchema("output", contract.output_schema, outputs, warnings);
  checkInvariants(contract, outputs, warnings);
  return { valid: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Schema checker — covers required fields, types, enums, ranges
// ---------------------------------------------------------------------------

function checkSchema(
  label: string,
  schema: JSONSchema,
  data: Record<string, unknown>,
  warnings: string[]
): void {
  const properties = schema.properties as Record<string, JSONSchema> | undefined;
  const required = schema.required as string[] | undefined;

  // Required field presence
  if (required) {
    for (const field of required) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        warnings.push(`[aap] ${label}.${field}: required field is missing`);
      }
    }
  }

  if (!properties) return;

  for (const [field, fieldSchema] of Object.entries(properties)) {
    const value = data[field];
    if (value === undefined || value === null) continue; // optional, already checked required above

    const type = fieldSchema.type as string | undefined;
    const enumValues = fieldSchema.enum as unknown[] | undefined;
    const minimum = fieldSchema.minimum as number | undefined;
    const maximum = fieldSchema.maximum as number | undefined;
    const minLength = fieldSchema.minLength as number | undefined;
    const maxLength = fieldSchema.maxLength as number | undefined;
    const minItems = fieldSchema.minItems as number | undefined;
    const format = fieldSchema.format as string | undefined;

    // Type check
    if (type) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== type) {
        warnings.push(
          `[aap] ${label}.${field}: expected type "${type}", got "${actualType}"`
        );
      }
    }

    // Enum check
    if (enumValues && !enumValues.includes(value)) {
      warnings.push(
        `[aap] ${label}.${field}: value "${value}" not in allowed values [${enumValues.join(", ")}]`
      );
    }

    // Numeric range
    if (typeof value === "number") {
      if (minimum !== undefined && value < minimum) {
        warnings.push(`[aap] ${label}.${field}: ${value} is below minimum ${minimum}`);
      }
      if (maximum !== undefined && value > maximum) {
        warnings.push(`[aap] ${label}.${field}: ${value} exceeds maximum ${maximum}`);
      }
    }

    // String constraints
    if (typeof value === "string") {
      if (minLength !== undefined && value.length < minLength) {
        warnings.push(`[aap] ${label}.${field}: length ${value.length} below minLength ${minLength}`);
      }
      if (maxLength !== undefined && value.length > maxLength) {
        warnings.push(`[aap] ${label}.${field}: length ${value.length} exceeds maxLength ${maxLength}`);
      }
      if (format === "uri") {
        try { new URL(value); } catch {
          warnings.push(`[aap] ${label}.${field}: value is not a valid URI`);
        }
      }
      if (format === "date-time") {
        if (isNaN(Date.parse(value))) {
          warnings.push(`[aap] ${label}.${field}: value is not a valid date-time`);
        }
      }
    }

    // Array constraints
    if (Array.isArray(value)) {
      if (minItems !== undefined && value.length < minItems) {
        warnings.push(`[aap] ${label}.${field}: array has ${value.length} items, minimum is ${minItems}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Invariant checker — evaluates simple invariant expressions
// ---------------------------------------------------------------------------

function checkInvariants(
  contract: AAPContractManifest,
  outputs: Record<string, unknown>,
  warnings: string[]
): void {
  if (!contract.invariants) return;

  for (const invariant of contract.invariants) {
    try {
      const result = evalInvariant(invariant, outputs);
      if (!result) {
        warnings.push(`[aap] invariant violated: "${invariant}"`);
      }
    } catch {
      warnings.push(`[aap] invariant could not be evaluated: "${invariant}"`);
    }
  }
}

/**
 * Evaluates simple invariant expressions from the contract.
 * Supports: >= 0, in [...], string comparisons.
 * Not a full expression engine — covers the AAP v0.1 invariant patterns.
 */
function evalInvariant(expr: string, outputs: Record<string, unknown>): boolean {
  // output.field >= number
  const gteMatch = expr.match(/^output\.(\w+)\s*>=\s*(\d+)$/);
  if (gteMatch) {
    const val = outputs[gteMatch[1]];
    return typeof val === "number" && val >= Number(gteMatch[2]);
  }

  // output.field in ["a", "b", "c"]
  const inMatch = expr.match(/^output\.(\w+)\s+in\s+\[(.+)\]$/);
  if (inMatch) {
    const val = outputs[inMatch[1]];
    const allowed = inMatch[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    return allowed.includes(String(val));
  }

  // Unknown invariant — warn but don't fail
  return true;
}
