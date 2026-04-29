/**
 * Skill Installer (P8-T4)
 * 
 * Install, list, and remove skills from various sources.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { Skill } from "./types.js";
import { SkillManifest as StandardManifest, ManifestValidator, manifestToSkill, createManifest } from "./manifest.js";
import { SkillRegistry as InstalledSkillRegistry } from "./registry.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface InstallOptions {
  /** Force reinstall if already exists */
  force?: boolean;
  
  /** Skip dependency installation */
  skipDeps?: boolean;
  
  /** Skip permission prompts */
  skipPermissions?: boolean;
  
  /** Specific version to install */
  version?: string;
  
  /** Installation source registry */
  registry?: string;
}

export interface InstallResult {
  success: boolean;
  skill?: Skill;
  manifest?: StandardManifest;
  message: string;
  installedPath?: string;
}

export interface InstalledSkill {
  name: string;
  version: string;
  source: string;
  installedAt: string;
  path: string;
  manifest: StandardManifest;
}

export interface SkillRegistrySource {
  /** Registry name */
  name: string;
  /** Registry URL */
  url: string;
  /** Is this the default registry */
  isDefault?: boolean;
}

// ─── Skill Installer ───────────────────────────────────────────────

export class SkillInstaller {
  private installDir: string;
  private registryUrl: string;
  private validator: ManifestValidator;
  private skillRegistry: InstalledSkillRegistry;

  constructor(
    installDir: string,
    skillRegistry: InstalledSkillRegistry,
    registryUrl: string = "https://registry.rookie.ai"
  ) {
    this.installDir = installDir;
    this.skillRegistry = skillRegistry;
    this.registryUrl = registryUrl;
    this.validator = new ManifestValidator();
  }

  /**
   * Install a skill from various sources
   */
  async install(source: string, options: InstallOptions = {}): Promise<InstallResult> {
    // Determine source type
    if (source.startsWith("http://") || source.startsWith("https://")) {
      return this.installFromUrl(source, options);
    }
    
    if (source.startsWith("file://") || source.startsWith("/") || source.startsWith(".")) {
      return this.installFromPath(source.replace("file://", ""), options);
    }
    
    if (source.includes("/")) {
      // GitHub shorthand: owner/repo
      if (!source.startsWith("@") && source.split("/").length === 2) {
        return this.installFromGitHub(source, options);
      }
      // Full package name
      return this.installFromRegistry(source, options);
    }
    
    // Simple name - search registry
    return this.installFromRegistry(source, options);
  }

  /**
   * Install from a URL
   */
  private async installFromUrl(url: string, options: InstallOptions): Promise<InstallResult> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          success: false,
          message: `Failed to fetch from ${url}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type");
      
      if (contentType?.includes("application/json")) {
        const manifest = await response.json() as StandardManifest;
        return this.installFromManifest(manifest, options);
      }
      
      if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
        return this.installFromArchive(url, "tar.gz", options);
      }
      
      if (url.endsWith(".zip")) {
        return this.installFromArchive(url, "zip", options);
      }

      return {
        success: false,
        message: `Unsupported content type: ${contentType}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to install from URL: ${error}`,
      };
    }
  }

  /**
   * Install from local path
   */
  private async installFromPath(localPath: string, options: InstallOptions): Promise<InstallResult> {
    try {
      const stat = await fs.stat(localPath);
      
      if (stat.isFile()) {
        if (localPath.endsWith(".json")) {
          const content = await fs.readFile(localPath, "utf-8");
          const manifest = JSON.parse(content) as StandardManifest;
          return this.installFromManifest(manifest, options);
        }
        
        if (localPath.endsWith(".tar.gz") || localPath.endsWith(".tgz")) {
          return this.installFromArchive(localPath, "tar.gz", options);
        }
        
        if (localPath.endsWith(".zip")) {
          return this.installFromArchive(localPath, "zip", options);
        }
      }
      
      if (stat.isDirectory()) {
        // Look for manifest.json or skill.json
        const manifestPath = path.join(localPath, "manifest.json");
        const skillJsonPath = path.join(localPath, "skill.json");
        
        try {
          const content = await fs.readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(content) as StandardManifest;
          return this.installFromManifest(manifest, { ...options, localPath });
        } catch {
          // Try skill.json
          try {
            const content = await fs.readFile(skillJsonPath, "utf-8");
            const skill = JSON.parse(content) as Skill;
            const manifest = createManifest(skill, { id: `local/${skill.name}` });
            return this.installFromManifest(manifest, { ...options, localPath });
          } catch {
            return {
              success: false,
              message: `No manifest.json or skill.json found in ${localPath}`,
            };
          }
        }
      }

      return {
        success: false,
        message: `Unsupported path type: ${localPath}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to install from path: ${error}`,
      };
    }
  }

  /**
   * Install from GitHub
   */
  private async installFromGitHub(repo: string, options: InstallOptions): Promise<InstallResult> {
    // Convert owner/repo to raw GitHub URL
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/manifest.json`;
    return this.installFromUrl(rawUrl, options);
  }

  /**
   * Install from registry
   */
  private async installFromRegistry(name: string, options: InstallOptions): Promise<InstallResult> {
    try {
      const registryUrl = `${this.registryUrl}/skills/${name}`;
      const response = await fetch(registryUrl);
      
      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            message: `Skill "${name}" not found in registry`,
          };
        }
        return {
          success: false,
          message: `Registry error: ${response.statusText}`,
        };
      }

      const manifest = await response.json() as StandardManifest;
      return this.installFromManifest(manifest, options);
    } catch (error) {
      return {
        success: false,
        message: `Failed to fetch from registry: ${error}`,
      };
    }
  }

  /**
   * Install from archive
   */
  private async installFromArchive(
    _urlOrPath: string,
    format: "tar.gz" | "zip",
    _options: InstallOptions
  ): Promise<InstallResult> {
    // Would implement archive extraction here
    // For now, return not implemented
    return {
      success: false,
      message: `Archive installation not yet implemented (${format})`,
    };
  }

  /**
   * Install from validated manifest
   */
  private async installFromManifest(
    manifest: StandardManifest,
    options: InstallOptions & { localPath?: string }
  ): Promise<InstallResult> {
    // Validate manifest
    const validation = this.validator.validate(manifest);
    if (!validation.valid) {
      return {
        success: false,
        message: `Invalid manifest:\n${validation.errors.map(e => `- ${e.field}: ${e.message}`).join("\n")}`,
      };
    }

    const skillId = manifest.skill.id;
    const installPath = path.join(this.installDir, skillId.replace("/", "-"));

    // Check if already installed
    try {
      await fs.access(installPath);
      if (!options.force) {
        return {
          success: false,
          message: `Skill "${skillId}" is already installed. Use --force to reinstall.`,
        };
      }
    } catch {
      // Not installed, continue
    }

    try {
      // Create install directory
      await fs.mkdir(installPath, { recursive: true });

      // Copy files if local path provided
      if (options.localPath) {
        await this.copyDirectory(options.localPath, installPath);
      }

      // Write manifest
      await fs.writeFile(
        path.join(installPath, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf-8"
      );

      // Write skill.json (legacy format)
      const skill = manifestToSkill(manifest);
      await fs.writeFile(
        path.join(installPath, "skill.json"),
        JSON.stringify({
          schema_version: "1.0",
          skill,
          created_at: manifest.timestamps.created,
          updated_at: manifest.timestamps.updated,
        }, null, 2),
        "utf-8"
      );

      // Install dependencies if needed
      if (!options.skipDeps && manifest.dependencies.skills) {
        for (const dep of manifest.dependencies.skills) {
          const [depName, depVersion] = dep.split("@");
          await this.install(depName, { ...options, version: depVersion });
        }
      }

      // Register with skill registry
      this.skillRegistry.register(skill);

      return {
        success: true,
        skill,
        manifest,
        message: `Successfully installed "${skillId}" v${manifest.skill.version}`,
        installedPath: installPath,
      };
    } catch (error) {
      // Cleanup on failure
      try {
        await fs.rm(installPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        message: `Installation failed: ${error}`,
      };
    }
  }

  /**
   * Remove an installed skill
   */
  async remove(skillId: string): Promise<{ success: boolean; message: string }> {
    const installPath = path.join(this.installDir, skillId.replace("/", "-"));

    try {
      await fs.access(installPath);
    } catch {
      return {
        success: false,
        message: `Skill "${skillId}" is not installed`,
      };
    }

    try {
      // Read manifest to get skill name for registry removal
      const manifestPath = path.join(installPath, "manifest.json");
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content) as StandardManifest;

      // Remove from filesystem
      await fs.rm(installPath, { recursive: true, force: true });

      // Remove from registry
      this.skillRegistry.remove(manifest.skill.name);

      return {
        success: true,
        message: `Successfully removed "${skillId}"`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove skill: ${error}`,
      };
    }
  }

  /**
   * List all installed skills
   */
  async list(): Promise<InstalledSkill[]> {
    const skills: InstalledSkill[] = [];

    try {
      const entries = await fs.readdir(this.installDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(this.installDir, entry.name);
          const manifestPath = path.join(skillPath, "manifest.json");

          try {
            const content = await fs.readFile(manifestPath, "utf-8");
            const manifest = JSON.parse(content) as StandardManifest;
            const stat = await fs.stat(manifestPath);

            skills.push({
              name: manifest.skill.name,
              version: manifest.skill.version,
              source: manifest.skill.id,
              installedAt: stat.birthtime.toISOString(),
              path: skillPath,
              manifest,
            });
          } catch {
            // Skip invalid entries
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get info about an installed skill
   */
  async info(skillId: string): Promise<InstalledSkill | null> {
    const installPath = path.join(this.installDir, skillId.replace("/", "-"));
    const manifestPath = path.join(installPath, "manifest.json");

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(content) as StandardManifest;
      const stat = await fs.stat(manifestPath);

      return {
        name: manifest.skill.name,
        version: manifest.skill.version,
        source: manifest.skill.id,
        installedAt: stat.birthtime.toISOString(),
        path: installPath,
        manifest,
      };
    } catch {
      return null;
    }
  }

  /**
   * Update an installed skill
   */
  async update(skillId: string): Promise<InstallResult> {
    const info = await this.info(skillId);
    if (!info) {
      return {
        success: false,
        message: `Skill "${skillId}" is not installed`,
      };
    }

    // Re-install from source
    return this.install(info.source, { force: true });
  }

  /**
   * Search registry for skills
   */
  async search(query: string): Promise<Array<{ id: string; name: string; description: string }>> {
    try {
      const searchUrl = `${this.registryUrl}/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl);
      
      if (!response.ok) {
        return [];
      }

      return await response.json() as Array<{ id: string; name: string; description: string }>;
    } catch {
      return [];
    }
  }

  // ─── Helper Methods ──────────────────────────────────────────────

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

// ─── CLI Integration ───────────────────────────────────────────────

export function createInstallCommand(installer: SkillInstaller) {
  return {
    name: "skill:install",
    description: "Install a skill from URL, registry, or local path",
    args: [
      { name: "source", description: "URL, registry name, or local path", required: true, type: "string" },
    ],
    options: [
      { name: "force", description: "Force reinstall if exists", alias: "f", type: "boolean" },
      { name: "skip-deps", description: "Skip dependency installation", type: "boolean" },
      { name: "version", description: "Specific version to install", alias: "v", type: "string" },
    ],
    handler: async (ctx: { args: string[]; options: Record<string, unknown>; logger: { info: (msg: string) => void; error: (msg: string) => void } }) => {
      const source = ctx.args[0];
      const options: InstallOptions = {
        force: ctx.options.force as boolean,
        skipDeps: ctx.options["skip-deps"] as boolean,
        version: ctx.options.version as string,
      };

      ctx.logger.info(`Installing skill from "${source}"...`);
      
      const result = await installer.install(source, options);
      
      if (result.success) {
        ctx.logger.info(`✓ ${result.message}`);
      } else {
        ctx.logger.error(`✗ ${result.message}`);
        process.exit(1);
      }
    },
  };
}

export function createListCommand(installer: SkillInstaller) {
  return {
    name: "skill:list",
    description: "List installed skills",
    handler: async (ctx: { logger: { info: (msg: string) => void } }) => {
      const skills = await installer.list();
      
      if (skills.length === 0) {
        ctx.logger.info("No skills installed.");
        return;
      }

      ctx.logger.info("Installed skills:");
      ctx.logger.info("");
      
      for (const skill of skills) {
        ctx.logger.info(`  ${skill.name}@${skill.version}`);
        ctx.logger.info(`    Source: ${skill.source}`);
        ctx.logger.info(`    Path: ${skill.path}`);
        ctx.logger.info("");
      }
    },
  };
}

export function createRemoveCommand(installer: SkillInstaller) {
  return {
    name: "skill:remove",
    description: "Remove an installed skill",
    args: [
      { name: "name", description: "Skill ID or name", required: true, type: "string" },
    ],
    handler: async (ctx: { args: string[]; logger: { info: (msg: string) => void; error: (msg: string) => void } }) => {
      const name = ctx.args[0];
      
      ctx.logger.info(`Removing skill "${name}"...`);
      
      const result = await installer.remove(name);
      
      if (result.success) {
        ctx.logger.info(`✓ ${result.message}`);
      } else {
        ctx.logger.error(`✗ ${result.message}`);
        process.exit(1);
      }
    },
  };
}
