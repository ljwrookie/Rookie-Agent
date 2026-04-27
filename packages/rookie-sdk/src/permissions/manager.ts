import {
  AskDecision,
  PermissionAction,
  PermissionRule,
  PermissionSource,
  PERMISSION_SOURCE_PRIORITY,
  RememberScope,
  DenialTrackingConfig,
  PermissionErrorCode,
} from "./types.js";

/**
 * Error thrown when permission denials exceed configured thresholds.
 */
export class PermissionDenialError extends Error {
  readonly code: PermissionErrorCode;
  readonly consecutiveCount: number;
  readonly totalCount: number;

  constructor(
    code: PermissionErrorCode,
    message: string,
    stats?: { consecutive: number; total: number },
  ) {
    super(message);
    this.name = "PermissionDenialError";
    this.code = code;
    this.consecutiveCount = stats?.consecutive ?? 0;
    this.totalCount = stats?.total ?? 0;
  }
}

/**
 * Notified whenever the user's approval decision wants to be persisted beyond
 * the in-flight call. `session` decisions are already stored in-memory by
 * `PermissionManager`; `forever` decisions need to land in
 * `.rookie/settings.local.json` which is the host's responsibility.
 */
export type PermissionPersistHandler = (
  rule: PermissionRule,
  scope: RememberScope,
) => void | Promise<void>;

/**
 * PermissionManager: checks tool invocation permissions.
 * Implements 8-source overlay system for permission resolution.
 *
 * Source priority (highest to lowest):
 *   1. cliArg       -- CLI arguments like --allow-write
 *   2. flagSettings -- Feature flag settings
 *   3. policySettings -- Organization policies
 *   4. managed      -- Managed/enterprise policy
 *   5. project      -- Project-level .rookie/settings.json
 *   6. user         -- User-level ~/.rookie/settings.json
 *   7. session      -- In-memory session rules
 *   8. default      -- Built-in defaults
 *
 * Default rules:
 *   - allow: file_read, search_code, git_status, git_diff
 *   - ask:   file_write, file_edit, git_commit, shell_execute
 *   - deny:  dangerous shell patterns
 */
export class PermissionManager {
  /** Rules organized by source for 8-source overlay system */
  private rulesBySource: Map<PermissionSource, PermissionRule[]> = new Map();
  private persistHandlers: PermissionPersistHandler[] = [];

  /** Denial tracking counters */
  private consecutiveDenialCount = 0;
  private totalDenialCount = 0;
  private denialConfig: DenialTrackingConfig;

  constructor(config?: Partial<DenialTrackingConfig>) {
    // Initialize all source buckets
    const sources: PermissionSource[] = [
      "cliArg",
      "flagSettings",
      "policySettings",
      "managed",
      "project",
      "user",
      "session",
      "default",
    ];
    for (const source of sources) {
      this.rulesBySource.set(source, []);
    }

    // Default rules (lowest priority)
    this.rulesBySource.set("default", [
      { tool: "file_read", action: "allow", source: "default" },
      { tool: "search_code", action: "allow", source: "default" },
      { tool: "git_status", action: "allow", source: "default" },
      { tool: "git_diff", action: "allow", source: "default" },
      { tool: "file_write", action: "ask", source: "default" },
      { tool: "file_edit", action: "ask", source: "default" },
      { tool: "shell_execute", action: "ask", source: "default" },
    ]);

    // Denial tracking config with defaults
    this.denialConfig = {
      maxConsecutiveDenials: 3,
      maxTotalDenials: 20,
      ...config,
    };
  }

  /**
   * Get current denial statistics.
   */
  getDenialStats(): { consecutive: number; total: number } {
    return {
      consecutive: this.consecutiveDenialCount,
      total: this.totalDenialCount,
    };
  }

  /**
   * Check if denials have exceeded thresholds.
   * Returns error code if exceeded, null otherwise.
   */
  checkDenialLimits(): PermissionErrorCode | null {
    if (this.consecutiveDenialCount >= this.denialConfig.maxConsecutiveDenials) {
      return "MAX_CONSECUTIVE_DENIALS_REACHED";
    }
    if (this.totalDenialCount >= this.denialConfig.maxTotalDenials) {
      return "MAX_TOTAL_DENIALS_REACHED";
    }
    return null;
  }

  /**
   * Reset consecutive denial counter (call when a permission is granted).
   */
  resetConsecutiveDenials(): void {
    this.consecutiveDenialCount = 0;
  }

  /**
   * Increment denial counters (call when a permission is denied).
   */
  incrementDenials(): PermissionErrorCode | null {
    this.consecutiveDenialCount++;
    this.totalDenialCount++;
    return this.checkDenialLimits();
  }

  /**
   * Load rules from settings, automatically categorizing by source.
   * Settings can specify a source field, or we infer from context.
   */
  loadFromSettings(
    settings: Record<string, unknown>,
    source: PermissionSource = "project",
  ): void {
    const permissions = settings.permissions as PermissionRule[] | undefined;
    if (permissions) {
      // Tag rules with source and add to appropriate bucket
      const rulesWithSource = permissions.map((r) => ({ ...r, source }));
      const existing = this.rulesBySource.get(source) || [];
      this.rulesBySource.set(source, [...rulesWithSource, ...existing]);
    }
  }

  /**
   * Check permission for a tool using 8-source overlay.
   * Sources are checked in priority order (cliArg highest, default lowest).
   */
  check(toolName: string, params?: Record<string, unknown>): PermissionAction {
    // Sort sources by priority (lower number = higher priority)
    const sortedSources = (Array.from(this.rulesBySource.entries()) as [
      PermissionSource,
      PermissionRule[],
    ][]).sort((a, b) => {
      return PERMISSION_SOURCE_PRIORITY[a[0]] - PERMISSION_SOURCE_PRIORITY[b[0]];
    });

    // Check each source in priority order
    for (const [, rules] of sortedSources) {
      for (const rule of rules) {
        if (this.matchesTool(rule.tool, toolName)) {
          if (rule.args && params) {
            // Check argument pattern
            const argsStr = JSON.stringify(params);
            if (!argsStr.includes(rule.args)) continue;
          }
          return rule.action;
        }
      }
    }
    // Default: ask
    return "ask";
  }

  /**
   * Get the effective rule for a tool (for debugging/introspection).
   * Returns the highest priority matching rule and its source.
   */
  getEffectiveRule(
    toolName: string,
    params?: Record<string, unknown>,
  ): { rule: PermissionRule; source: PermissionSource } | null {
    const sortedSources = (Array.from(this.rulesBySource.entries()) as [
      PermissionSource,
      PermissionRule[],
    ][]).sort((a, b) => {
      return PERMISSION_SOURCE_PRIORITY[a[0]] - PERMISSION_SOURCE_PRIORITY[b[0]];
    });

    for (const [source, rules] of sortedSources) {
      for (const rule of rules) {
        if (this.matchesTool(rule.tool, toolName)) {
          if (rule.args && params) {
            const argsStr = JSON.stringify(params);
            if (!argsStr.includes(rule.args)) continue;
          }
          return { rule, source };
        }
      }
    }
    return null;
  }

  /**
   * Add a rule to a specific source bucket.
   * Use addSessionRule() for session rules, addRule() for project-level.
   */
  addRule(rule: PermissionRule, source: PermissionSource = "project"): void {
    const ruleWithSource = { ...rule, source };
    const existing = this.rulesBySource.get(source) || [];
    this.rulesBySource.set(source, [ruleWithSource, ...existing]);
  }

  /** Register a rule that only lives for the current process (session source). */
  addSessionRule(rule: PermissionRule): void {
    const sessionRules = this.rulesBySource.get("session") || [];
    // De-dup: replace a matching session rule instead of stacking.
    const key = `${rule.tool}::${rule.args ?? ""}`;
    const filtered = sessionRules.filter(
      (r) => `${r.tool}::${r.args ?? ""}` !== key,
    );
    this.rulesBySource.set("session", [{ ...rule, source: "session" }, ...filtered]);
  }

  clearSessionRules(): void {
    this.rulesBySource.set("session", []);
  }

  /**
   * Load rules from CLI arguments (highest priority).
   * Example: --allow-write, --allow-shell
   */
  loadFromCliArgs(cliArgs: { allow?: string[]; deny?: string[] }): void {
    const cliRules: PermissionRule[] = [];

    if (cliArgs.allow) {
      for (const tool of cliArgs.allow) {
        cliRules.push({ tool, action: "allow", source: "cliArg" });
      }
    }

    if (cliArgs.deny) {
      for (const tool of cliArgs.deny) {
        cliRules.push({ tool, action: "deny", source: "cliArg" });
      }
    }

    this.rulesBySource.set("cliArg", cliRules);
  }

  /**
   * Load rules from feature flags.
   */
  loadFromFeatureFlags(flags: Record<string, PermissionAction>): void {
    const flagRules: PermissionRule[] = Object.entries(flags).map(
      ([tool, action]) => ({
        tool,
        action,
        source: "flagSettings",
      }),
    );
    this.rulesBySource.set("flagSettings", flagRules);
  }

  /**
   * Get all rules from a specific source.
   */
  getRulesBySource(source: PermissionSource): PermissionRule[] {
    return this.rulesBySource.get(source) || [];
  }

  /**
   * Get summary of rules across all sources (for debugging).
   */
  getRulesSummary(): Record<PermissionSource, number> {
    const summary = {} as Record<PermissionSource, number>;
    for (const [source, rules] of this.rulesBySource.entries()) {
      summary[source] = rules.length;
    }
    return summary;
  }

  /**
   * Hook for hosts that want to materialize `forever` approval decisions to
   * disk. Multiple handlers are supported so TUI + CLI can both react.
   */
  onPersist(handler: PermissionPersistHandler): void {
    this.persistHandlers.push(handler);
  }

  /**
   * Apply an `AskDecision` coming from the approval UI.
   *  - `once`    → no-op (caller already used the boolean).
   *  - `session` → append to session rules.
   *  - `forever` → append to session rules AND notify persist handlers.
   *
   * Also tracks denial counts and throws if thresholds are exceeded.
   */
  async applyAskDecision(
    toolName: string,
    decision: AskDecision,
    params?: Record<string, unknown>,
  ): Promise<void> {
    // Track denials
    if (!decision.allowed) {
      const errorCode = this.incrementDenials();
      if (errorCode) {
        const stats = this.getDenialStats();
        throw new PermissionDenialError(
          errorCode,
          `Permission denied for ${toolName}. ` +
          `${errorCode === "MAX_CONSECUTIVE_DENIALS_REACHED"
            ? `Reached ${this.denialConfig.maxConsecutiveDenials} consecutive denials`
            : `Reached ${this.denialConfig.maxTotalDenials} total denials`}. ` +
          `Stats: ${stats.consecutive} consecutive, ${stats.total} total.`,
        );
      }
    } else {
      // Reset consecutive counter on allow
      this.resetConsecutiveDenials();
    }

    const scope: RememberScope = decision.remember ?? "once";
    if (scope === "once") return;

    const rule: PermissionRule = {
      tool: toolName,
      action: decision.allowed ? "allow" : "deny",
      args: this.deriveArgsPattern(params),
    };
    this.addSessionRule(rule);

    if (scope === "forever") {
      for (const handler of this.persistHandlers) {
        await handler(rule, scope);
      }
    }
  }

  /**
   * Best-effort arg pattern: currently we do not attempt to parse params and
   * always leave `args` undefined. Exposed as a method so future refinement
   * (e.g. deriving a path prefix from `file_edit`) doesn't change the call
   * sites.
   */
  private deriveArgsPattern(_params?: Record<string, unknown>): string | undefined {
    return undefined;
  }

  private matchesTool(pattern: string, toolName: string): boolean {
    if (pattern === toolName) return true;
    // Simple glob: * matches anything
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(toolName);
    }
    return false;
  }
}
