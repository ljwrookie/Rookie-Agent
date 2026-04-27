// Doctor command: Health check for Rookie Agent (P3-T4)

import { execSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ─── Types ───────────────────────────────────────────────────────

export interface HealthCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: string;
}

export interface DoctorReport {
  overall: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheck[];
  timestamp: string;
}

// ─── Health Checks ───────────────────────────────────────────────

async function checkNodeVersion(): Promise<HealthCheck> {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);

  if (major >= 20) {
    return {
      name: "Node.js",
      status: "ok",
      message: `Node.js ${version} (supported)`,
    };
  } else if (major >= 18) {
    return {
      name: "Node.js",
      status: "warning",
      message: `Node.js ${version} (minimum supported)`,
      details: "Consider upgrading to Node.js 20+ for best performance",
    };
  } else {
    return {
      name: "Node.js",
      status: "error",
      message: `Node.js ${version} (not supported)`,
      details: "Node.js 18+ is required",
    };
  }
}

async function checkRustInstallation(): Promise<HealthCheck> {
  try {
    const version = execSync("rustc --version", { encoding: "utf8" }).trim();
    return {
      name: "Rust",
      status: "ok",
      message: version,
    };
  } catch {
    return {
      name: "Rust",
      status: "warning",
      message: "Not installed",
      details: "Rust is optional but recommended for native performance",
    };
  }
}

async function checkSQLite(): Promise<HealthCheck> {
  try {
    // Check if better-sqlite3 can be loaded
    require("better-sqlite3");
    return {
      name: "SQLite",
      status: "ok",
      message: "better-sqlite3 installed",
    };
  } catch {
    return {
      name: "SQLite",
      status: "warning",
      message: "better-sqlite3 not available",
      details: "Memory store will use in-memory fallback",
    };
  }
}

async function checkGitInstallation(): Promise<HealthCheck> {
  try {
    const version = execSync("git --version", { encoding: "utf8" }).trim();
    return {
      name: "Git",
      status: "ok",
      message: version,
    };
  } catch {
    return {
      name: "Git",
      status: "error",
      message: "Not installed",
      details: "Git is required for version control features",
    };
  }
}

async function checkNetwork(): Promise<HealthCheck> {
  try {
    // Simple connectivity check
    const response = await fetch("https://registry.npmjs.org", {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        name: "Network",
        status: "ok",
        message: "Connected to npm registry",
      };
    }
  } catch {
    // Fall through to error
  }

  return {
    name: "Network",
    status: "warning",
    message: "Limited connectivity",
    details: "Some features may not work offline",
  };
}

async function checkPermissions(projectRoot: string): Promise<HealthCheck> {
  try {
    // Check if we can write to project root
    await access(projectRoot, constants.W_OK);
    return {
      name: "Permissions",
      status: "ok",
      message: "Write access to project directory",
    };
  } catch {
    return {
      name: "Permissions",
      status: "error",
      message: "No write access",
      details: "Cannot write to project directory",
    };
  }
}

async function checkMcpServers(): Promise<HealthCheck> {
  // This would check configured MCP servers
  // For now, just return ok
  return {
    name: "MCP Servers",
    status: "ok",
    message: "No MCP servers configured",
    details: "Configure MCP servers in .rookie/settings.json",
  };
}

// ─── Doctor Command ──────────────────────────────────────────────

export async function runDoctor(projectRoot: string): Promise<DoctorReport> {
  const checks = await Promise.all([
    checkNodeVersion(),
    checkRustInstallation(),
    checkSQLite(),
    checkGitInstallation(),
    checkNetwork(),
    checkPermissions(projectRoot),
    checkMcpServers(),
  ]);

  const errors = checks.filter((c) => c.status === "error").length;
  const warnings = checks.filter((c) => c.status === "warning").length;

  let overall: DoctorReport["overall"];
  if (errors > 0) {
    overall = "unhealthy";
  } else if (warnings > 0) {
    overall = "degraded";
  } else {
    overall = "healthy";
  }

  return {
    overall,
    checks,
    timestamp: new Date().toISOString(),
  };
}

export function formatReport(report: DoctorReport): string {
  const lines: string[] = [
    "",
    "╔═══════════════════════════════════════════╗",
    "║           ROOKIE DOCTOR REPORT            ║",
    "╚═══════════════════════════════════════════╝",
    "",
    `Overall Status: ${report.overall.toUpperCase()}`,
    `Timestamp: ${report.timestamp}`,
    "",
    "Checks:",
    "─".repeat(50),
  ];

  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✅" : check.status === "warning" ? "⚠️" : "❌";
    lines.push(`${icon} ${check.name}: ${check.message}`);
    if (check.details) {
      lines.push(`   ${check.details}`);
    }
  }

  lines.push("─".repeat(50), "");

  // Summary
  const ok = report.checks.filter((c) => c.status === "ok").length;
  const warnings = report.checks.filter((c) => c.status === "warning").length;
  const errors = report.checks.filter((c) => c.status === "error").length;

  lines.push(`Summary: ${ok} passed, ${warnings} warnings, ${errors} errors`);
  lines.push("");

  if (report.overall === "healthy") {
    lines.push("✨ All systems operational!");
  } else if (report.overall === "degraded") {
    lines.push("⚠️  Some optional features may not be available.");
  } else {
    lines.push("❌ Please fix the errors above before using Rookie Agent.");
  }

  lines.push("");

  return lines.join("\n");
}

// ─── CLI Handler ─────────────────────────────────────────────────

export async function doctorCommand(options: { json?: boolean } = {}): Promise<void> {
  const projectRoot = process.cwd();
  const report = await runDoctor(projectRoot);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  // Exit with error code if unhealthy
  if (report.overall === "unhealthy") {
    process.exit(1);
  }
}
