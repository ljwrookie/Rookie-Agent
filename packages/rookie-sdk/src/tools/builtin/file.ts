import { readFile, writeFile, access } from "fs/promises";
import { Tool } from "../types.js";
import { saveSnapshot } from "../snapshot.js";

// B9: File read tool with CCB-aligned parameters
export const fileReadTool: Tool = {
  name: "file_read",
  description:
    "Read the contents of a file. Returns the full text content. " +
    "Use this to understand code, check configurations, or read documentation. " +
    "Supports line range selection and offset-based reading for large files.",
  parameters: [
    { name: "file_path", type: "string", description: "Absolute or relative file path to read", required: true },
    { name: "offset", type: "number", description: "Character offset to start reading from (0-based)", required: false },
    { name: "limit", type: "number", description: "Maximum number of characters to read", required: false },
    { name: "start_line", type: "number", description: "Start line number (1-based, inclusive)", required: false },
    { name: "end_line", type: "number", description: "End line number (1-based, inclusive)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    // B9: Support both old and new parameter names
    const filePath = String(params.file_path ?? params.path);
    const offset = typeof params.offset === "number" ? params.offset : undefined;
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const startLine = typeof params.start_line === "number" ? params.start_line :
                     (typeof params.startLine === "number" ? params.startLine : undefined);
    const endLine = typeof params.end_line === "number" ? params.end_line :
                   (typeof params.endLine === "number" ? params.endLine : undefined);

    // Check file exists
    try {
      await access(filePath);
    } catch {
      return `[ERROR] File not found: ${filePath}`;
    }

    let content = await readFile(filePath, "utf-8");

    // B9: Apply offset/limit if specified (character-based)
    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : content.length;
      content = content.slice(start, end);

      if (offset !== undefined && offset > 0) {
        content = `[... skipped ${offset} chars]\n${content}`;
      }
      if (end < (await readFile(filePath, "utf-8")).length) {
        content += `\n[... more content available]`;
      }
    }

    // B9: Apply line range if specified
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n");
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = endLine ?? lines.length;
      const slice = lines.slice(start, end);
      return slice.map((l, i) => `${start + i + 1}: ${l}`).join("\n");
    }

    return content;
  },
};

// B9: File write tool with CCB-aligned parameters
export const fileWriteTool: Tool = {
  name: "file_write",
  description:
    "Write content to a file (creates or overwrites). " +
    "Use this to create new files or completely replace file content. " +
    "Automatically creates parent directories if they don't exist.",
  parameters: [
    { name: "file_path", type: "string", description: "Absolute or relative file path to write to", required: true },
    { name: "content", type: "string", description: "Content to write to the file", required: true },
  ],
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  async execute(params, context) {
    // B9: Support both old and new parameter names
    const filePath = String(params.file_path ?? params.path);
    const content = String(params.content);

    // B4: Save snapshot before writing (if file exists)
    if (context?.projectRoot) {
      await saveSnapshot(context.projectRoot, filePath);
    }

    // Ensure parent directories exist
    const { mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(filePath), { recursive: true });

    await writeFile(filePath, content, "utf-8");
    return `File written: ${filePath} (${content.length} chars)`;
  },
};

// B9: File edit tool with CCB-aligned parameters
export const fileEditTool: Tool = {
  name: "file_edit",
  description:
    "Edit a file by replacing a specific text range. " +
    "Provide the old text to find and the new text to replace it with. " +
    "This is safer than file_write for targeted changes. " +
    "Requires exact match and will fail if multiple matches are found.",
  parameters: [
    { name: "file_path", type: "string", description: "Absolute or relative file path to edit", required: true },
    {
      name: "old_string",
      type: "string",
      description: "Exact text to find and replace (must match exactly including whitespace)",
      required: true,
    },
    {
      name: "new_string",
      type: "string",
      description: "Text to replace old_string with",
      required: true,
    },
    {
      name: "expected_replacements",
      type: "number",
      description: "Expected number of replacements (default: 1, use -1 for unlimited)",
      required: false,
    },
  ],
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  async execute(params, context) {
    // B9: Support both old and new parameter names
    const filePath = String(params.file_path ?? params.path);
    const oldText = String(params.old_string ?? params.old_text);
    const newText = String(params.new_string ?? params.new_text);
    const expectedReplacements = typeof params.expected_replacements === "number"
      ? params.expected_replacements
      : 1;

    // Check file exists
    try {
      await access(filePath);
    } catch {
      return `[ERROR] File not found: ${filePath}`;
    }

    // B4: Save snapshot before editing
    if (context?.projectRoot) {
      await saveSnapshot(context.projectRoot, filePath);
    }

    const content = await readFile(filePath, "utf-8");

    // Count matches
    let matchCount = 0;
    let pos = 0;
    while ((pos = content.indexOf(oldText, pos)) !== -1) {
      matchCount++;
      pos += oldText.length;
    }

    if (matchCount === 0) {
      return `[ERROR] Could not find the specified text in ${filePath}. ` +
        `Make sure old_string matches exactly (including whitespace and line breaks).`;
    }

    // B9: Check expected replacements
    if (expectedReplacements > 0 && matchCount !== expectedReplacements) {
      return `[WARNING] Found ${matchCount} matches for old_string in ${filePath}, ` +
        `but expected ${expectedReplacements}. ` +
        `Use expected_replacements: ${matchCount} to replace all, or provide more specific text.`;
    }

    // B9: If multiple matches and expected_replacements is -1, replace all
    const replaceAll = expectedReplacements === -1;
    let newContent: string;

    if (replaceAll) {
      newContent = content.split(oldText).join(newText);
    } else {
      // Replace only the first occurrence
      const idx = content.indexOf(oldText);
      newContent = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
    }

    await writeFile(filePath, newContent, "utf-8");

    const lineNum = content.indexOf(oldText) !== -1
      ? content.slice(0, content.indexOf(oldText)).split("\n").length
      : 0;

    const replacedCount = replaceAll ? matchCount : 1;
    return `File edited: ${filePath} (${replacedCount} replacement${replacedCount > 1 ? "s" : ""} at line ${lineNum}, ` +
      `${oldText.length} chars -> ${newText.length} chars)`;
  },
};
