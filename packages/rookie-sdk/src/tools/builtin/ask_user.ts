// ─── AskUserQuestion Tool ────────────────────────────────────────
// B10.2: Pause execution to ask user for clarification/choice

import { Tool } from "../types.js";

export interface AskUserQuestionOptions {
  /** Callback to present question to user and get response */
  askUser: (question: string, options?: string[]) => Promise<string>;
}

interface AskUserParams {
  question: string;
  options?: string[];
  defaultValue?: string;
  allowFreeText?: boolean;
}

export function createAskUserQuestionTool(options: AskUserQuestionOptions): Tool {
  return {
    name: "AskUserQuestion",
    description:
      "Pause execution and ask the user a question. " +
      "Use this when you need clarification, confirmation, or a choice between options. " +
      "The user can select from predefined options or provide free-text input.",
    parameters: [
      {
        name: "question",
        type: "string",
        description: "The question to ask the user",
        required: true,
      },
      {
        name: "options",
        type: "array",
        description: "Optional list of predefined options for the user to choose from",
        required: false,
      },
      {
        name: "default_value",
        type: "string",
        description: "Default value if user provides no input",
        required: false,
      },
      {
        name: "allow_free_text",
        type: "boolean",
        description: "Whether to allow free-text input (default: true)",
        required: false,
      },
    ],
    isReadOnly: true,
    isConcurrencySafe: false,
    async execute(params: Record<string, unknown>): Promise<string> {
      const config: AskUserParams = {
        question: String(params.question),
        options: Array.isArray(params.options) ? params.options.map(String) : undefined,
        defaultValue: params.default_value ? String(params.default_value) : undefined,
        allowFreeText: typeof params.allow_free_text === "boolean" ? params.allow_free_text : true,
      };

      if (!config.question.trim()) {
        return "[ERROR] Question cannot be empty";
      }

      try {
        // Format question with options if provided
        let formattedQuestion = config.question;
        if (config.options && config.options.length > 0) {
          formattedQuestion += "\n\nOptions:\n";
          config.options.forEach((opt, i) => {
            formattedQuestion += `  ${i + 1}. ${opt}\n`;
          });
          if (config.allowFreeText) {
            formattedQuestion += "\n(Or type your own answer)";
          }
        }

        const response = await options.askUser(formattedQuestion, config.options);

        // Use default if no response
        const finalResponse = response.trim() || config.defaultValue || "";

        return `User response: ${finalResponse}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `[ERROR] Failed to get user response: ${message}`;
      }
    },
  };
}

// Default implementation that uses console input
// In production, this would integrate with the TUI
async function defaultAskUser(question: string, _options?: string[]): Promise<string> {
  const readline = await import("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question}\n> `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export const askUserQuestionTool: Tool = createAskUserQuestionTool({
  askUser: defaultAskUser,
});
