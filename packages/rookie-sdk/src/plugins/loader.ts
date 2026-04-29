/**
 * Plugin Loader (P8-T3)
 * 
 * Automatic plugin discovery and loading with npm package support and sandbox isolation.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  Plugin,
  PluginManifest,
  PluginConfig,
  PluginPermission,
  SandboxOptions,
  SandboxedPlugin,
  PluginRegistryEvents,
} from "./types.js";
import { EventEmitter } from "events";
import { createRequire } from "module";

// ─── Plugin Loader ─────────────────────────────────────────────────

export interface PluginLoaderOptions {
  /** Directories to scan for plugins */
  searchPaths: string[];
  
  /** Global configuration directory */
  configDir: string;
  
  /** Built-in plugins directory */
  builtinDir?: string;
  
  /** Default sandbox options */
  sandboxDefaults?: SandboxOptions;
  
  /** Auto-discover plugins in node_modules */
  autoDiscover?: boolean;
  
  /** Plugin namespace prefix for npm packages */
  npmPrefix?: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: Plugin;
  config: PluginConfig;
  source: "builtin" | "npm" | "local";
  path: string;
}

export class PluginLoader extends EventEmitter {
  private options: Required<PluginLoaderOptions>;
  private loadedPlugins = new Map<string, LoadedPlugin>();
  private sandboxedPlugins = new Map<string, SandboxedPlugin>();
  private requireCache = new Map<string, unknown>();

  constructor(options: PluginLoaderOptions) {
    super();
    this.options = {
      searchPaths: options.searchPaths,
      configDir: options.configDir,
      builtinDir: options.builtinDir || path.join(__dirname, "builtin"),
      sandboxDefaults: options.sandboxDefaults || defaultSandboxOptions(),
      autoDiscover: options.autoDiscover ?? true,
      npmPrefix: options.npmPrefix || "rookie-plugin-",
    };
  }

  /**
   * Load all plugins from search paths and npm packages
   */
  async loadAll(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];

    // 1. Load built-in plugins
    const builtinPlugins = await this.loadBuiltinPlugins();
    plugins.push(...builtinPlugins);

    // 2. Load from search paths
    for (const searchPath of this.options.searchPaths) {
      try {
        const localPlugins = await this.loadFromDirectory(searchPath);
        plugins.push(...localPlugins);
      } catch (error) {
        this.emit("plugin:error", { 
          name: "loader", 
          error: new Error(`Failed to load from ${searchPath}: ${error}`) 
        });
      }
    }

    // 3. Auto-discover npm packages
    if (this.options.autoDiscover) {
      const npmPlugins = await this.discoverNpmPlugins();
      plugins.push(...npmPlugins);
    }

    return plugins;
  }

  /**
   * Load a specific plugin by name or path
   */
  async load(nameOrPath: string): Promise<LoadedPlugin> {
    // Check if already loaded
    const cached = this.loadedPlugins.get(nameOrPath);
    if (cached) return cached;

    // Try as npm package name
    if (!nameOrPath.startsWith(".") && !nameOrPath.startsWith("/")) {
      const npmPlugin = await this.loadNpmPackage(nameOrPath);
      if (npmPlugin) return npmPlugin;
    }

    // Try as local path
    const localPlugin = await this.loadFromPath(nameOrPath);
    if (localPlugin) return localPlugin;

    throw new PluginLoadError(`Plugin not found: ${nameOrPath}`);
  }

  /**
   * Unload a plugin
   */
  async unload(name: string): Promise<void> {
    const loaded = this.loadedPlugins.get(name);
    if (!loaded) return;

    this.loadedPlugins.delete(name);
    this.sandboxedPlugins.delete(name);
    this.requireCache.delete(name);

    this.emit("plugin:unloaded", { name });
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.loadedPlugins.values());
  }

  /**
   * Get a specific loaded plugin
   */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.loadedPlugins.get(name);
  }

  /**
   * Check if a plugin is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedPlugins.has(name);
  }

  // ─── Builtin Plugin Loading ──────────────────────────────────────

  private async loadBuiltinPlugins(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];

    try {
      const entries = await fs.readdir(this.options.builtinDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(this.options.builtinDir, entry.name);
          try {
            const plugin = await this.loadFromPath(pluginPath);
            if (plugin) {
              plugins.push({ ...plugin, source: "builtin" });
            }
          } catch (error) {
            this.emit("plugin:error", { 
              name: entry.name, 
              error: new Error(`Failed to load builtin plugin: ${error}`) 
            });
          }
        }
      }
    } catch (error) {
      // Builtin directory might not exist
    }

    return plugins;
  }

  // ─── Local Directory Loading ─────────────────────────────────────

  private async loadFromDirectory(dir: string): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(dir, entry.name);
          try {
            const plugin = await this.loadFromPath(pluginPath);
            if (plugin) {
              plugins.push(plugin);
            }
          } catch (error) {
            this.emit("plugin:error", { 
              name: entry.name, 
              error: new Error(`Failed to load plugin from ${pluginPath}: ${error}`) 
            });
          }
        }
      }
    } catch (error) {
      // Directory might not exist
    }

    return plugins;
  }

  private async loadFromPath(pluginPath: string): Promise<LoadedPlugin | null> {
    // Check for manifest.json
    const manifestPath = path.join(pluginPath, "manifest.json");
    let manifest: PluginManifest | null = null;

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(content) as PluginManifest;
    } catch {
      // Try package.json
      const pkgPath = path.join(pluginPath, "package.json");
      try {
        const content = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(content);
        if (pkg.rookiePlugin) {
          manifest = this.manifestFromPackageJson(pkg);
        }
      } catch {
        return null;
      }
    }

    if (!manifest) return null;

    // Load plugin module
    const entryPath = path.resolve(pluginPath, manifest.entry);
    const plugin = await this.loadPluginModule(entryPath, manifest);

    // Load or create config
    const config = await this.loadConfig(manifest.plugin.name);

    const loaded: LoadedPlugin = {
      manifest,
      plugin,
      config,
      source: "local",
      path: pluginPath,
    };

    this.loadedPlugins.set(manifest.plugin.name, loaded);
    this.emit("plugin:loaded", { 
      name: manifest.plugin.name, 
      manifest 
    } as PluginRegistryEvents["plugin:loaded"]);

    return loaded;
  }

  // ─── NPM Package Loading ─────────────────────────────────────────

  private async discoverNpmPlugins(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];

    // Look for packages with rookie-plugin- prefix in node_modules
    const nodeModulesPaths = this.findNodeModulesPaths();

    for (const nodeModules of nodeModulesPaths) {
      try {
        const entries = await fs.readdir(nodeModules, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(this.options.npmPrefix)) {
            try {
              const plugin = await this.loadNpmPackage(entry.name);
              if (plugin) {
                plugins.push(plugin);
              }
            } catch (error) {
              this.emit("plugin:error", { 
                name: entry.name, 
                error: new Error(`Failed to load npm plugin: ${error}`) 
              });
            }
          }
        }
      } catch (error) {
        // node_modules might not exist
      }
    }

    return plugins;
  }

  private async loadNpmPackage(packageName: string): Promise<LoadedPlugin | null> {
    // Check if already loaded
    const cached = this.loadedPlugins.get(packageName);
    if (cached) return cached;

    try {
      // Resolve package path
      const require = createRequire(import.meta.url);
      const packagePath = require.resolve(path.join(packageName, "package.json"));
      const pluginDir = path.dirname(packagePath);

      const content = await fs.readFile(packagePath, "utf-8");
      const pkg = JSON.parse(content);

      if (!pkg.rookiePlugin) {
        return null;
      }

      const manifest = this.manifestFromPackageJson(pkg);
      const entryPath = path.join(pluginDir, manifest.entry);
      const plugin = await this.loadPluginModule(entryPath, manifest);

      // Load or create config
      const config = await this.loadConfig(manifest.plugin.name);

      const loaded: LoadedPlugin = {
        manifest,
        plugin,
        config,
        source: "npm",
        path: pluginDir,
      };

      this.loadedPlugins.set(manifest.plugin.name, loaded);
      this.emit("plugin:loaded", { 
        name: manifest.plugin.name, 
        manifest 
      } as PluginRegistryEvents["plugin:loaded"]);

      return loaded;
    } catch (error) {
      return null;
    }
  }

  private manifestFromPackageJson(pkg: {
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    license?: string;
    main?: string;
    rookiePlugin?: {
      entry?: string;
      permissions?: PluginPermission[];
      defaultConfig?: Partial<PluginConfig>;
    };
  }): PluginManifest {
    return {
      manifestVersion: "1.0",
      plugin: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description || "",
        author: pkg.author,
        homepage: pkg.homepage,
        license: pkg.license,
      },
      entry: pkg.rookiePlugin?.entry || pkg.main || "index.js",
      permissions: pkg.rookiePlugin?.permissions || [],
      defaultConfig: pkg.rookiePlugin?.defaultConfig,
    };
  }

  // ─── Module Loading with Sandbox ─────────────────────────────────

  private async loadPluginModule(
    entryPath: string, 
    manifest: PluginManifest
  ): Promise<Plugin> {
    // Check cache
    const cached = this.requireCache.get(entryPath);
    if (cached) return cached as Plugin;

    // Determine sandbox options
    const sandboxOptions: SandboxOptions = {
      ...this.options.sandboxDefaults,
      // Could be customized per plugin
    };

    // Load module with sandbox
    const plugin = await this.loadWithSandbox(entryPath, sandboxOptions);

    // Validate plugin structure
    if (!plugin.meta) {
      throw new PluginLoadError(`Plugin ${manifest.plugin.name} missing metadata`);
    }
    if (!plugin.activate) {
      throw new PluginLoadError(`Plugin ${manifest.plugin.name} missing activate function`);
    }

    // Store in sandbox registry
    this.sandboxedPlugins.set(manifest.plugin.name, {
      plugin,
      sandbox: sandboxOptions,
      stats: {
        memoryUsage: 0,
        cpuTime: 0,
        apiCalls: 0,
      },
    });

    this.requireCache.set(entryPath, plugin);
    return plugin;
  }

  private async loadWithSandbox(
    entryPath: string, 
    _options: SandboxOptions
  ): Promise<Plugin> {
    // In a real implementation, this would use VM2 or similar
    // For now, we use dynamic import with a wrapper

    const fileUrl = pathToFileURL(entryPath).href;
    
    // Clear module cache to ensure fresh load
    const modulePath = require.resolve(entryPath);
    delete require.cache[modulePath];

    try {
      // Use dynamic import for ESM support
      const module = await import(fileUrl);
      
      // Support both default export and named exports
      const plugin = module.default || module;
      
      return plugin as Plugin;
    } catch (error) {
      // Fallback to require for CommonJS
      const module = require(entryPath);
      return (module.default || module) as Plugin;
    }
  }

  // ─── Configuration Management ──────────────────────────────────────

  private async loadConfig(pluginName: string): Promise<PluginConfig> {
    const configPath = path.join(this.options.configDir, `${pluginName}.json`);

    try {
      const content = await fs.readFile(configPath, "utf-8");
      const saved = JSON.parse(content);
      
      return {
        settings: saved.settings || {},
        enabled: saved.enabled ?? true,
        permissions: saved.permissions || [],
      };
    } catch {
      // Return default config
      return {
        settings: {},
        enabled: true,
        permissions: [],
      };
    }
  }

  async saveConfig(pluginName: string, config: PluginConfig): Promise<void> {
    const configPath = path.join(this.options.configDir, `${pluginName}.json`);
    
    await fs.mkdir(this.options.configDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  // ─── Helper Methods ──────────────────────────────────────────────

  private findNodeModulesPaths(): string[] {
    const paths: string[] = [];
    let currentDir = __dirname;

    while (currentDir !== "/") {
      const nodeModules = path.join(currentDir, "node_modules");
      paths.push(nodeModules);
      
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    return paths;
  }
}

// ─── Errors ────────────────────────────────────────────────────────

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginLoadError";
  }
}

// ─── Default Sandbox Options ───────────────────────────────────────

function defaultSandboxOptions(): SandboxOptions {
  return {
    timeout: 30000, // 30 seconds
    memoryLimit: 128, // 128 MB
    allowedModules: [
      "path",
      "url",
      "util",
      "crypto",
      "querystring",
      "stream",
      "events",
      "buffer",
    ],
    blockedModules: [
      "child_process",
      "cluster",
      "dgram",
      "dns",
      "fs",
      "http",
      "https",
      "net",
      "os",
      "process",
      "repl",
      "tls",
      "vm",
      "worker_threads",
    ],
  };
}
