/**
 * CommandRegistry (P1-T2)
 *
 * Holds all slash commands (builtins + Skill-contributed) and provides:
 *   - register / unregister / list
 *   - prefix filtering for suggestion popups
 *   - execute(raw) to parse input and dispatch to the right handler
 *
 * Case-insensitive. Last-writer-wins on name/alias collisions — this lets a
 * SKILL.md override a builtin (intentional: users asked for it).
 */

import type { Skill } from "../skills/types.js";
import type {
  SlashCommand,
  SlashCommandContext,
  SlashCommandResult,
} from "./types.js";

const LEADING_SLASH = /^\/+/;

function normalise(name: string): string {
  return name.replace(LEADING_SLASH, "").trim().toLowerCase();
}

/**
 * Parse a raw input line into `{ name, args }`. Leading `/` and whitespace
 * tolerated; empty name yields an empty string.
 */
export function parseCommandInput(raw: string): { name: string; args: string[] } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return { name: "", args: [] };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: (head ?? "").toLowerCase(), args: rest };
}

export class CommandRegistry {
  // name (incl. aliases) → canonical command
  private byName = new Map<string, SlashCommand>();
  // canonical name → command (for list ordering / dedup)
  private primary = new Map<string, SlashCommand>();

  /**
   * Register a command. Aliases are indexed too. A later register() with the
   * same primary name replaces the previous entry (builtins → skills).
   */
  register(cmd: SlashCommand): void {
    const primary = normalise(cmd.name);
    if (!primary) throw new Error("CommandRegistry: command name is required");

    // Remove prior indexing for this primary (drops stale aliases).
    const prior = this.primary.get(primary);
    if (prior) {
      this.byName.delete(primary);
      for (const alias of prior.aliases ?? []) {
        const n = normalise(alias);
        if (this.byName.get(n) === prior) this.byName.delete(n);
      }
    }

    const canonical: SlashCommand = { ...cmd, name: primary };
    this.primary.set(primary, canonical);
    this.byName.set(primary, canonical);
    for (const alias of cmd.aliases ?? []) {
      const n = normalise(alias);
      if (n) this.byName.set(n, canonical);
    }
  }

  unregister(name: string): boolean {
    const primary = normalise(name);
    const cmd = this.primary.get(primary);
    if (!cmd) return false;
    this.primary.delete(primary);
    this.byName.delete(primary);
    for (const alias of cmd.aliases ?? []) {
      const n = normalise(alias);
      if (this.byName.get(n) === cmd) this.byName.delete(n);
    }
    return true;
  }

  get(name: string): SlashCommand | undefined {
    return this.byName.get(normalise(name));
  }

  has(name: string): boolean {
    return this.byName.has(normalise(name));
  }

  /** All primary commands, sorted by name. */
  list(): SlashCommand[] {
    return Array.from(this.primary.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Filter commands whose primary name or any alias starts with the supplied
   * fragment. The fragment may include the leading slash; it's stripped.
   * Primary-name matches float to the top so `/c` prefers `commit` over an
   * alias that happens to start with `c`.
   */
  filter(fragment: string, limit = 10): SlashCommand[] {
    const needle = normalise(fragment);
    if (!needle) return this.list().slice(0, limit);

    const primaryHits: SlashCommand[] = [];
    const aliasHits: SlashCommand[] = [];
    for (const cmd of this.primary.values()) {
      if (cmd.name.startsWith(needle)) {
        primaryHits.push(cmd);
        continue;
      }
      const aliasMatch = (cmd.aliases ?? []).some((a) => normalise(a).startsWith(needle));
      if (aliasMatch) aliasHits.push(cmd);
    }
    primaryHits.sort((a, b) => a.name.localeCompare(b.name));
    aliasHits.sort((a, b) => a.name.localeCompare(b.name));
    return [...primaryHits, ...aliasHits].slice(0, limit);
  }

  /**
   * Execute a raw `/command args…` line. Returns:
   *   - null when input is not a slash command or command is unknown.
   *   - SlashCommandResult from the handler otherwise.
   *
   * When the command is unknown we still return a structured error so the TUI
   * can surface it consistently.
   */
  async execute(
    raw: string,
    extra: { cwd?: string; meta?: Record<string, unknown> } = {},
  ): Promise<SlashCommandResult | null> {
    const { name, args } = parseCommandInput(raw);
    if (!name) return null;
    const cmd = this.byName.get(name);
    if (!cmd) {
      return { systemMessage: `Unknown command: /${name}` };
    }
    const ctx: SlashCommandContext = {
      raw,
      name,
      args,
      cwd: extra.cwd ?? process.cwd(),
      meta: extra.meta,
    };
    return cmd.handler(ctx);
  }

  // ── Skill bridge ─────────────────────────────────────────────────

  /**
   * Convert a Skill with a `command` trigger into a SlashCommand. Returns null
   * if the skill has no command trigger.
   *
   * The generated handler feeds the skill's prompt into the agent loop as
   * `prompt` — that matches how Skill invocation currently flows through
   * `onMessage`. Custom TUI embedders can override by re-registering the same
   * name.
   */
  static fromSkill(skill: Skill): SlashCommand | null {
    const trigger = skill.triggers.find((t) => t.type === "command");
    if (!trigger) return null;
    const raw = trigger.value.trim();
    const name = normalise(raw);
    if (!name) return null;
    const description = skill.description || `Skill: ${skill.name}`;
    return {
      name,
      description,
      usage: `/${name}`,
      category: "skill",
      source: "skill",
      skill,
      handler: async (ctx) => {
        const args = ctx.args.join(" ").trim();
        // Hand the skill's prompt to the agent loop; pass args as a trailer
        // so skills that expect parameters can still see them.
        const prompt = args.length > 0 ? `${skill.prompt}\n\nArgs: ${args}` : skill.prompt;
        return { prompt };
      },
    };
  }

  /**
   * Register all command-triggered skills from a registry-like source. Returns
   * the count of newly-registered commands.
   */
  registerSkills(skills: Iterable<Skill>): number {
    let count = 0;
    for (const skill of skills) {
      const cmd = CommandRegistry.fromSkill(skill);
      if (!cmd) continue;
      this.register(cmd);
      count += 1;
    }
    return count;
  }
}
