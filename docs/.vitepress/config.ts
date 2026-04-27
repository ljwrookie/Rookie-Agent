import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Rookie Agent",
  description: "AI-powered software engineering assistant",
  base: "/",

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "API", link: "/api/" },
      { text: "Examples", link: "/examples/" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/" },
            { text: "Quick Start", link: "/guide/quick-start" },
            { text: "Installation", link: "/guide/installation" },
          ],
        },
        {
          text: "Configuration",
          items: [
            { text: "Settings", link: "/guide/settings" },
            { text: "Models", link: "/guide/models" },
            { text: "Permissions", link: "/guide/permissions" },
          ],
        },
        {
          text: "Features",
          items: [
            { text: "Skills", link: "/guide/skills" },
            { text: "Hooks", link: "/guide/hooks" },
            { text: "Memory", link: "/guide/memory" },
            { text: "Scheduler", link: "/guide/scheduler" },
          ],
        },
        {
          text: "Advanced",
          items: [
            { text: "Self-optimization", link: "/guide/self-optimization" },
            { text: "Multi-platform", link: "/guide/gateway" },
          ],
        },
      ],
      "/api/": [
        {
          text: "SDK API",
          items: [
            { text: "RookieClient", link: "/api/client" },
            { text: "Agents", link: "/api/agents" },
            { text: "Tools", link: "/api/tools" },
            { text: "Memory", link: "/api/memory" },
          ],
        },
        {
          text: "CLI",
          items: [
            { text: "Commands", link: "/api/cli" },
            { text: "Configuration", link: "/api/cli-config" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Overview", link: "/examples/" },
            { text: "Fix Issue", link: "/examples/fix-issue" },
            { text: "Codebase QA", link: "/examples/codebase-qa" },
            { text: "PR Review", link: "/examples/pr-review" },
            { text: "Daily Standup", link: "/examples/daily-standup" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/bytedance/rookie-agent" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 ByteDance",
    },
  },
});
