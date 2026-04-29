/**
 * Skill CLI Commands (P8-T4)
 * 
 * `rookie skill install <url|name>`
 * `rookie skill list`
 * `rookie skill remove <name>`
 * `rookie skill search <query>`
 * `rookie skill info <name>`
 * `rookie skill update <name>`
 */

import { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import { SkillInstaller, SkillRegistry, ManifestValidator } from "@rookie/agent-sdk";
import type { InstallOptions } from "@rookie/agent-sdk";

export function registerSkillCommands(program: Command): void {
  const skillCmd = program
    .command("skill")
    .description("Manage Rookie skills");

  // Install command
  skillCmd
    .command("install <source>")
    .description("Install a skill from URL, registry name, or local path")
    .option("-f, --force", "Force reinstall if already exists")
    .option("--skip-deps", "Skip dependency installation")
    .option("-v, --version <version>", "Specific version to install")
    .option("-r, --registry <url>", "Use custom registry URL")
    .action(async (source: string, options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry, options.registry);

      console.log(`Installing skill from "${source}"...`);

      const installOptions: InstallOptions = {
        force: options.force,
        skipDeps: options.skipDeps,
        version: options.version,
        registry: options.registry,
      };

      const result = await installer.install(source, installOptions);

      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.installedPath) {
          console.log(`  Installed to: ${result.installedPath}`);
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
    });

  // List command
  skillCmd
    .command("list")
    .alias("ls")
    .description("List installed skills")
    .option("-j, --json", "Output as JSON")
    .action(async (options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry);

      const skills = await installer.list();

      if (options.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }

      if (skills.length === 0) {
        console.log("No skills installed.");
        console.log("Run `rookie skill install <name>` to install a skill.");
        return;
      }

      console.log("Installed skills:");
      console.log("");

      for (const skill of skills) {
        console.log(`  ${skill.name}@${skill.version}`);
        console.log(`    ID: ${skill.source}`);
        console.log(`    Description: ${skill.manifest.skill.description}`);
        if (skill.manifest.skill.author) {
          console.log(`    Author: ${skill.manifest.skill.author.name}`);
        }
        console.log(`    Installed: ${new Date(skill.installedAt).toLocaleDateString()}`);
        console.log("");
      }
    });

  // Remove command
  skillCmd
    .command("remove <name>")
    .alias("rm")
    .description("Remove an installed skill")
    .option("-y, --yes", "Skip confirmation")
    .action(async (name: string, options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry);

      // Get skill info first
      const info = await installer.info(name);
      if (!info) {
        console.error(`✗ Skill "${name}" is not installed`);
        process.exit(1);
      }

      if (!options.yes) {
        // Would use inquirer in production
        console.log(`About to remove: ${info.name}@${info.version}`);
        console.log("Use --yes to skip confirmation");
      }

      console.log(`Removing skill "${name}"...`);

      const result = await installer.remove(name);

      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
    });

  // Search command
  skillCmd
    .command("search <query>")
    .description("Search for skills in the registry")
    .option("-l, --limit <n>", "Limit results", "20")
    .action(async (query: string, options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry);

      console.log(`Searching for "${query}"...`);

      const results = await installer.search(query);

      if (results.length === 0) {
        console.log("No skills found.");
        return;
      }

      console.log(`Found ${results.length} skill(s):`);
      console.log("");

      for (const result of results.slice(0, parseInt(options.limit))) {
        console.log(`  ${result.id}`);
        console.log(`    ${result.description}`);
        console.log("");
      }
    });

  // Info command
  skillCmd
    .command("info <name>")
    .description("Show detailed information about an installed skill")
    .option("-j, --json", "Output as JSON")
    .action(async (name: string, options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry);

      const info = await installer.info(name);

      if (!info) {
        console.error(`✗ Skill "${name}" is not installed`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      const m = info.manifest;

      console.log(`${m.skill.name}@${m.skill.version}`);
      console.log("=" .repeat(40));
      console.log("");
      console.log(`ID: ${m.skill.id}`);
      console.log(`Description: ${m.skill.description}`);
      if (m.skill.longDescription) {
        console.log(`\n${m.skill.longDescription}`);
      }
      console.log("");

      if (m.skill.author) {
        console.log(`Author: ${m.skill.author.name}`);
        if (m.skill.author.email) console.log(`Email: ${m.skill.author.email}`);
      }

      if (m.skill.license) {
        console.log(`License: ${m.skill.license}`);
      }

      if (m.skill.keywords?.length) {
        console.log(`Keywords: ${m.skill.keywords.join(", ")}`);
      }

      if (m.skill.categories?.length) {
        console.log(`Categories: ${m.skill.categories.join(", ")}`);
      }

      console.log("");
      console.log("Triggers:");
      for (const trigger of m.skill.triggers) {
        console.log(`  - ${trigger.type}: ${trigger.value}`);
      }

      console.log("");
      console.log("Tools:");
      for (const tool of m.skill.tools) {
        console.log(`  - ${tool}`);
      }

      console.log("");
      console.log("Installation:");
      console.log(`  Path: ${info.path}`);
      console.log(`  Installed: ${new Date(info.installedAt).toLocaleString()}`);

      if (m.dependencies.rookie) {
        console.log(`  Requires Rookie: ${m.dependencies.rookie}`);
      }
    });

  // Update command
  skillCmd
    .command("update [name]")
    .description("Update installed skill(s)")
    .option("-a, --all", "Update all skills")
    .action(async (name: string | undefined, options) => {
      const installDir = path.join(process.cwd(), ".rookie", "skills");
      const registry = createRegistry(installDir);
      const installer = createInstaller(installDir, registry);

      if (options.all) {
        const skills = await installer.list();
        console.log(`Updating ${skills.length} skill(s)...`);

        for (const skill of skills) {
          console.log(`\nUpdating ${skill.name}...`);
          const result = await installer.update(skill.source);
          console.log(result.success ? `✓ ${result.message}` : `✗ ${result.message}`);
        }
      } else if (name) {
        console.log(`Updating ${name}...`);
        const result = await installer.update(name);

        if (result.success) {
          console.log(`✓ ${result.message}`);
        } else {
          console.error(`✗ ${result.message}`);
          process.exit(1);
        }
      } else {
        console.error("Please specify a skill name or use --all");
        process.exit(1);
      }
    });

  // Validate command
  skillCmd
    .command("validate <path>")
    .description("Validate a skill manifest")
    .action(async (manifestPath: string) => {
      const validator = new ManifestValidator();

      try {
        const content = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(content);

        const result = validator.validate(manifest);

        if (result.valid) {
          console.log("✓ Manifest is valid");

          if (result.warnings.length > 0) {
            console.log("\nWarnings:");
            for (const warning of result.warnings) {
              console.log(`  - ${warning.field}: ${warning.message}`);
              if (warning.suggestion) {
                console.log(`    Suggestion: ${warning.suggestion}`);
              }
            }
          }
        } else {
          console.error("✗ Manifest is invalid");
          console.error("\nErrors:");
          for (const error of result.errors) {
            console.error(`  - ${error.field}: ${error.message}`);
          }

          if (result.warnings.length > 0) {
            console.log("\nWarnings:");
            for (const warning of result.warnings) {
              console.log(`  - ${warning.field}: ${warning.message}`);
            }
          }

          process.exit(1);
        }
      } catch (error) {
        console.error(`✗ Failed to validate: ${error}`);
        process.exit(1);
      }
    });
}

// ─── Helper Functions ──────────────────────────────────────────────

function createRegistry(installDir: string): SkillRegistry {
  return new SkillRegistry({ storageDir: installDir });
}

function createInstaller(
  installDir: string,
  registry: SkillRegistry,
  registryUrl?: string
): SkillInstaller {
  return new SkillInstaller(
    installDir,
    registry,
    registryUrl || "https://registry.rookie.ai"
  );
}
