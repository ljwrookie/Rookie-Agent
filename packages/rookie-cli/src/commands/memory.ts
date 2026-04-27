// Memory command: Show user model and memory stats (P2-T4)

import { UserModelManager } from "@rookie/agent-sdk";

export interface MemoryShowOptions {
  projectRoot: string;
  userId?: string;
  format?: "text" | "json";
}

export async function runMemoryShow(options: MemoryShowOptions): Promise<number> {
  const manager = new UserModelManager({
    storageDir: `${options.projectRoot}/.rookie/user-models`,
    reflectionInterval: 20,
    minSessionsBeforeReflection: 5,
  });

  const userId = options.userId || "default";
  const model = await manager.getModel(userId);

  if (options.format === "json") {
    console.log(JSON.stringify(model, null, 2));
    return 0;
  }

  console.log(`\n# User Model: ${model.userId}`);
  console.log(`Sessions analyzed: ${model.sessionCount}`);
  console.log(`Created: ${model.createdAt}`);
  console.log(`Updated: ${model.updatedAt}`);

  console.log("\n## Preferences");
  console.log(`  Languages: ${model.preferences.languages.join(", ") || "not specified"}`);
  console.log(`  Code style: ${model.preferences.codeStyle}`);
  console.log(`  Testing: ${model.preferences.testing}`);
  console.log(`  Imports: ${model.preferences.imports}`);

  console.log("\n## Tech Stack");
  console.log(`  Frameworks: ${model.stack.frameworks.join(", ") || "not specified"}`);
  console.log(`  Build tools: ${model.stack.buildTools.join(", ") || "not specified"}`);
  console.log(`  Databases: ${model.stack.databases.join(", ") || "not specified"}`);

  console.log("\n## Communication Style");
  console.log(`  Detail level: ${model.communication.detailLevel}`);
  console.log(`  Likes examples: ${model.communication.likesExamples ? "yes" : "no"}`);
  console.log(`  Code first: ${model.communication.codeFirst ? "yes" : "no"}`);

  if (model.goals.learning.length > 0 || model.goals.interests.length > 0) {
    console.log("\n## Goals & Interests");
    if (model.goals.learning.length) {
      console.log(`  Learning: ${model.goals.learning.join(", ")}`);
    }
    if (model.goals.interests.length) {
      console.log(`  Interests: ${model.goals.interests.join(", ")}`);
    }
  }

  if (model.insights.length > 0) {
    console.log("\n## Key Insights (last 5)");
    model.insights.slice(-5).forEach((insight) => {
      console.log(`  - ${insight}`);
    });
  }

  return 0;
}
