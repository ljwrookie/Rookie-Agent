// Update command: Self-update functionality (P3-T4)

import { execSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ─── Types ───────────────────────────────────────────────────────

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string;
}

export interface UpdateOptions {
  checkOnly?: boolean;
  force?: boolean;
  channel?: "stable" | "beta" | "canary";
}

// ─── Version Utilities ───────────────────────────────────────────

function parseVersion(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number);
}

function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }

  return 0;
}

// ─── Update Check ────────────────────────────────────────────────

export async function checkUpdate(): Promise<UpdateInfo> {
  // Get current version
  const packageJson = require("../../package.json");
  const currentVersion = packageJson.version;

  try {
    // Query npm registry for latest version
    const response = await fetch(
      `https://registry.npmjs.org/${packageJson.name}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      throw new Error(`Registry error: ${response.status}`);
    }

    const data = await response.json() as {
      "dist-tags": { latest: string };
    };
    const latestVersion = data["dist-tags"].latest;

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  }
}

// ─── Update Installation ─────────────────────────────────────────

export async function installUpdate(version?: string): Promise<boolean> {
  const packageName = "@rookie-agent/cli";
  const target = version ? `${packageName}@${version}` : packageName;

  console.log(`Installing ${target}...`);

  try {
    // Check if running via npx
    const isNpx = process.env.npm_execpath?.includes("npx") || false;

    if (isNpx) {
      console.log("Note: You're running via npx. Install globally for persistent updates:");
      console.log(`  npm install -g ${target}`);
      return false;
    }

    // Check if installed globally
    const isGlobal = await isGloballyInstalled(packageName);

    if (isGlobal) {
      execSync(`npm install -g ${target}`, {
        stdio: "inherit",
        timeout: 120000,
      });
    } else {
      // Local installation
      execSync(`npm install ${target}`, {
        stdio: "inherit",
        timeout: 120000,
      });
    }

    return true;
  } catch (error) {
    console.error("Update failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

async function isGloballyInstalled(packageName: string): Promise<boolean> {
  try {
    const globalList = execSync("npm list -g --depth=0", { encoding: "utf8" });
    return globalList.includes(packageName);
  } catch {
    return false;
  }
}

// ─── Cargo Update (for Rust core) ─────────────────────────────────

export async function checkCargoUpdate(): Promise<UpdateInfo> {
  try {
    // Check if cargo is available
    execSync("cargo --version", { stdio: "ignore" });

    // This would check for updates to the Rust core
    // For now, return no update available
    return {
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      updateAvailable: false,
    };
  } catch {
    return {
      currentVersion: "not installed",
      latestVersion: "not installed",
      updateAvailable: false,
    };
  }
}

// ─── CLI Handler ─────────────────────────────────────────────────

export async function updateCommand(options: UpdateOptions = {}): Promise<void> {
  console.log("Checking for updates...\n");

  // Check CLI update
  const cliUpdate = await checkUpdate();

  console.log(`CLI: ${cliUpdate.currentVersion}`);
  console.log(`Latest: ${cliUpdate.latestVersion}`);

  if (!cliUpdate.updateAvailable) {
    console.log("\n✅ CLI is up to date!");
  } else {
    console.log("\n⬆️  Update available!");

    if (options.checkOnly) {
      console.log(`\nRun 'rookie update' to install ${cliUpdate.latestVersion}`);
      return;
    }

    if (options.force || await confirmUpdate()) {
      const success = await installUpdate(cliUpdate.latestVersion);
      if (success) {
        console.log("\n✅ Update installed successfully!");
        console.log("Please restart Rookie Agent to use the new version.");
      } else {
        console.log("\n❌ Update failed.");
        process.exit(1);
      }
    }
  }

  // Check Rust core update (if applicable)
  const cargoUpdate = await checkCargoUpdate();
  if (cargoUpdate.updateAvailable) {
    console.log(`\nRust core update available: ${cargoUpdate.latestVersion}`);
    console.log("Run 'cargo install rookie-core' to update.");
  }
}

async function confirmUpdate(): Promise<boolean> {
  // In a real implementation, this would use a prompt library
  // For now, assume yes in non-interactive environments
  if (process.env.CI || process.env.NONINTERACTIVE) {
    return true;
  }

  // Simple stdin-based confirmation
  process.stdout.write("\nProceed with update? [Y/n] ");

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    stdin.once("data", (data) => {
      stdin.setRawMode?.(false);
      stdin.pause();

      const input = String(data).trim().toLowerCase();
      console.log();
      resolve(input === "" || input === "y" || input === "yes");
    });
  });
}

// ─── Version Command ─────────────────────────────────────────────

export async function versionCommand(): Promise<void> {
  const packageJson = require("../../package.json");

  console.log(`Rookie Agent CLI v${packageJson.version}`);
  console.log(`Node.js ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);

  // Check for updates without installing
  try {
    const update = await checkUpdate();
    if (update.updateAvailable) {
      console.log(`\n⬆️  Update available: ${update.latestVersion}`);
      console.log(`   Run 'rookie update' to upgrade`);
    }
  } catch {
    // Ignore update check errors
  }
}
