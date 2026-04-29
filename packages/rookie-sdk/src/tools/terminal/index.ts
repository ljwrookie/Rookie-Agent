/**
 * Terminal backends module
 *
 * Provides unified interface for executing commands across different environments:
 * - Local shell
 * - Docker containers
 * - SSH remote hosts
 * - Daytona workspaces
 */

// Export types
export * from "./types.js";

// Export base class and registry
export { TerminalBackend, TerminalBackendRegistry } from "./backend.js";

// Export backend implementations
export { LocalTerminalBackend } from "./local.js";
export { DockerTerminalBackend } from "./docker.js";
export { SSHTerminalBackend } from "./ssh.js";
export { DaytonaTerminalBackend } from "./daytona.js";

// Re-export for convenience
import { TerminalBackendRegistry } from "./backend.js";
import { LocalTerminalBackend } from "./local.js";
import { DockerTerminalBackend } from "./docker.js";
import { SSHTerminalBackend } from "./ssh.js";
import { DaytonaTerminalBackend } from "./daytona.js";

// Ensure all backends are registered
export function registerAllBackends(): void {
  // Backends auto-register when their modules are imported
  // This function ensures they're loaded
  console.log("Available terminal backends:", TerminalBackendRegistry.list());
}
