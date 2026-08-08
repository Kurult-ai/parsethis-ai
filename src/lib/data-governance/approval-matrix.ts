/**
 * Action Approval Matrix — Task 8.5
 *
 * Evaluates an actionType × dataClassification pair against a configurable
 * matrix to produce one of three decisions:
 *   - allow            → no action needed
 *   - require_approval → triggers the existing approval flow
 *   - block            → hard block, enforced through the enforcement dial
 *
 * The matrix is stored as JSON on ScreeningPolicy.approvalMatrix.
 * Key format: "{actionType}_{classification}"
 * Value: "allow" | "require_approval" | "block"
 *
 * When a cell is not present in the matrix, the built-in default template
 * determines the decision (see DEFAULT_APPROVAL_MATRIX).
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type MatrixDecision = "allow" | "require_approval" | "block";

export type ActionType =
  | "send_external"
  | "write_data"
  | "delete_data"
  | "execute_code"
  | "financial";

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

/** The matrix as stored in DB: flat key→value map. */
export type ApprovalMatrix = Record<string, MatrixDecision>;

// ─── Constants ──────────────────────────────────────────────────────────

export const VALID_ACTION_TYPES: readonly ActionType[] = [
  "send_external",
  "write_data",
  "delete_data",
  "execute_code",
  "financial",
] as const;

export const VALID_CLASSIFICATIONS: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export const VALID_DECISIONS: readonly MatrixDecision[] = [
  "allow",
  "require_approval",
  "block",
] as const;

/**
 * Default approval matrix template.
 *
 * Sensible defaults:
 *   - delete_data × confidential/restricted → require_approval
 *   - send_external × restricted            → block
 *   - financial × any                       → require_approval
 *   - execute_code × restricted             → require_approval
 *   - everything else                       → allow
 */
export const DEFAULT_APPROVAL_MATRIX: ApprovalMatrix = {
  // send_external
  send_external_public: "allow",
  send_external_internal: "allow",
  send_external_confidential: "require_approval",
  send_external_restricted: "block",

  // write_data
  write_data_public: "allow",
  write_data_internal: "allow",
  write_data_confidential: "allow",
  write_data_restricted: "require_approval",

  // delete_data
  delete_data_public: "allow",
  delete_data_internal: "allow",
  delete_data_confidential: "require_approval",
  delete_data_restricted: "require_approval",

  // execute_code
  execute_code_public: "allow",
  execute_code_internal: "allow",
  execute_code_confidential: "require_approval",
  execute_code_restricted: "block",

  // financial
  financial_public: "require_approval",
  financial_internal: "require_approval",
  financial_confidential: "require_approval",
  financial_restricted: "block",
};

// ─── Helpers ────────────────────────────────────────────────────────────

/** Build the matrix cell key from action type and classification. */
export function matrixKey(actionType: string, classification: string): string {
  return `${actionType}_${classification}`;
}

/** Check if a value is a valid action type. */
export function isValidActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (VALID_ACTION_TYPES as readonly string[]).includes(value);
}

/** Check if a value is a valid data classification. */
export function isValidClassification(value: unknown): value is DataClassification {
  return typeof value === "string" && (VALID_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * Normalize a stored matrix value.
 * Falls back to the default template if the stored matrix is null/empty/invalid.
 */
export function normalizeMatrix(raw: unknown): ApprovalMatrix {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_APPROVAL_MATRIX };
  }

  const obj = raw as Record<string, unknown>;
  const normalized: ApprovalMatrix = {};

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string" && (VALID_DECISIONS as readonly string[]).includes(val)) {
      normalized[key] = val as MatrixDecision;
    }
  }

  return normalized;
}

// ─── Core Evaluation ────────────────────────────────────────────────────

/**
 * Evaluate an actionType × dataClassification pair against the approval matrix.
 *
 * If the matrix contains an explicit cell, that value wins.
 * If the cell is missing, fall back to the default template.
 * If neither is present, default to "allow".
 *
 * @param matrix    The approval matrix (as stored on ScreeningPolicy)
 * @param actionType The action being performed (e.g. "delete_data")
 * @param classification The data classification (e.g. "confidential")
 * @returns The decision: "allow", "require_approval", or "block"
 */
export function evaluateMatrix(
  matrix: ApprovalMatrix | null | undefined,
  actionType: string,
  classification: string,
): MatrixDecision {
  const key = matrixKey(actionType, classification);

  // Explicit override in the configured matrix
  if (matrix && matrix[key]) {
    return matrix[key];
  }

  // Fall back to default template
  if (DEFAULT_APPROVAL_MATRIX[key]) {
    return DEFAULT_APPROVAL_MATRIX[key];
  }

  // Unknown action × classification — default to allow (fail open for extensibility)
  return "allow";
}

/**
 * Validate an approval matrix submitted via API.
 * Returns an array of error strings (empty if valid).
 */
export function validateMatrix(matrix: unknown): string[] {
  const errors: string[] = [];

  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    errors.push("approval_matrix must be a JSON object");
    return errors;
  }

  const obj = matrix as Record<string, unknown>;

  for (const [key, val] of Object.entries(obj)) {
    // Validate key format: actionType_classification
    const parts = key.split("_");
    if (parts.length < 2) {
      errors.push(`Invalid matrix key "${key}": must be in format "{actionType}_{classification}"`);
      continue;
    }

    // The classification is the last segment; the actionType is everything before it
    const classification = parts[parts.length - 1];
    const actionType = parts.slice(0, -1).join("_");

    if (!isValidActionType(actionType)) {
      errors.push(
        `Invalid action type "${actionType}" in key "${key}": must be one of ${VALID_ACTION_TYPES.join(", ")}`,
      );
    }

    if (!isValidClassification(classification)) {
      errors.push(
        `Invalid classification "${classification}" in key "${key}": must be one of ${VALID_CLASSIFICATIONS.join(", ")}`,
      );
    }

    if (typeof val !== "string" || !(VALID_DECISIONS as readonly string[]).includes(val)) {
      errors.push(
        `Invalid decision "${val}" for key "${key}": must be one of ${VALID_DECISIONS.join(", ")}`,
      );
    }
  }

  return errors;
}

/**
 * Get the effective (merged) matrix: user overrides + defaults.
 * Used for the GET endpoint so users see their complete effective policy.
 */
export function getEffectiveMatrix(userMatrix: ApprovalMatrix | null | undefined): ApprovalMatrix {
  return { ...DEFAULT_APPROVAL_MATRIX, ...(userMatrix ?? {}) };
}

/**
 * Get just the user-configured overrides (non-default cells).
 * Used for storage so we don't persist redundant defaults.
 */
export function getUserOverrides(fullMatrix: ApprovalMatrix): ApprovalMatrix {
  const overrides: ApprovalMatrix = {};
  for (const [key, val] of Object.entries(fullMatrix)) {
    if (DEFAULT_APPROVAL_MATRIX[key] !== val) {
      overrides[key] = val;
    }
  }
  return overrides;
}
