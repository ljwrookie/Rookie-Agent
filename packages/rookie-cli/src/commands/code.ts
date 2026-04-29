import { startTuiCodeMode } from "../tui/index.js";

export interface CodeModeOptions {
  record?: boolean;
}

export async function startCodeMode(options: CodeModeOptions = {}): Promise<void> {
  await startTuiCodeMode(options);
}
