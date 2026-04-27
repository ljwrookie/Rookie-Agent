// Permission control types (from Claude Code)

export type PermissionAction = "allow" | "deny" | "ask";

/** Permission source types - 8-source overlay system */
export type PermissionSource =
  | "cliArg"      // --allow-* CLI arguments (highest priority)
  | "flagSettings" // Feature flag settings
  | "policySettings" // Organization policy settings
  | "managed"     // Managed/enterprise policy
  | "project"     // Project-level .rookie/settings.json
  | "user"        // User-level ~/.rookie/settings.json
  | "session"     // In-memory session rules
  | "default";    // Built-in defaults (lowest priority)

/** Priority order for permission sources (lower number = higher priority) */
export const PERMISSION_SOURCE_PRIORITY: Record<PermissionSource, number> = {
  cliArg: 0,
  flagSettings: 1,
  policySettings: 2,
  managed: 3,
  project: 4,
  user: 5,
  session: 6,
  default: 7,
};

export interface PermissionRule {
  tool: string;       // tool name or glob pattern
  args?: string;      // argument pattern (optional)
  action: PermissionAction;
  source?: PermissionSource;  // Which source this rule came from
}

/** Where an approval decision should be remembered. */
export type RememberScope = "once" | "session" | "forever";

/**
 * Result returned by the approval UI when the user responds to an `ask` rule.
 * `once` is the default: affect only the in-flight invocation.
 * `session` persists into `PermissionManager.sessionRules` for the process.
 * `forever` should be written to `.rookie/settings.local.json` by the host.
 */
export interface AskDecision {
  allowed: boolean;
  remember?: RememberScope;
}

/**
 * Denial tracking configuration.
 * When denials exceed thresholds, the system aborts to prevent infinite loops.
 */
export interface DenialTrackingConfig {
  /** Maximum consecutive denials before abort (default: 3) */
  maxConsecutiveDenials: number;
  /** Maximum total denials before abort (default: 20) */
  maxTotalDenials: number;
}

/** Error codes for permission-related errors */
export type PermissionErrorCode =
  | "MAX_CONSECUTIVE_DENIALS_REACHED"
  | "MAX_TOTAL_DENIALS_REACHED";
