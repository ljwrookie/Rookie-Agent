<div align="center">

# 🤖 Rookie Agent

**AI-powered software engineering assistant with TypeScript orchestration and Rust compute engine.**

<p>
  <a href="https://github.com/bytedance/Rookie-Agent/actions"><img src="https://img.shields.io/github/actions/workflow/status/bytedance/Rookie-Agent/ci.yml?branch=main&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://github.com/bytedance/Rookie-Agent/releases"><img src="https://img.shields.io/github/v/release/bytedance/Rookie-Agent?style=flat-square" alt="Release" /></a>
  <a href="https://github.com/bytedance/Rookie-Agent/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bytedance/Rookie-Agent?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

[English](#english) | [中文](#中文)

</div>

---

<a name="english"></a>
## English

### Overview

Rookie Agent is an all-in-one AI agent designed for software engineering tasks. It combines a **TypeScript orchestration layer** with a **Rust compute engine** to deliver high-performance code analysis, multi-agent collaboration, and intelligent task automation.

### Features

| Feature | Description |
|---------|-------------|
| 🧠 **Multi-Agent Orchestration** | Coder, Explorer, Reviewer, Architect, Planner, Evaluator — specialized agents working together |
| 📋 **Long-Task Harness** | Session persistence, progress tracking, and feature verification for complex workflows |
| 🔄 **Self-Improving Skills** | Auto-generate and optimize skills from usage patterns |
| 🧩 **Structured Memory** | Episodic, semantic, and user model memory layers |
| 🌐 **Multi-Platform** | CLI, TUI, Web UI, and gateway support (Feishu/Lark, Slack, Discord, Telegram, WeCom) |
| 🛠️ **Built-in Tools** | 16+ tools for file, shell, git, web, notebook, and MCP operations |
| ⚡ **Rust Core** | High-performance AST parsing, code search, diff engine, and vector indexing |
| 🔌 **Extensible** | Plugin system, custom skills, hooks, and MCP (Model Context Protocol) support |

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CLI    │  │   TUI    │  │  Web UI  │  │ Gateways │   │
│  │ (Node.js)│  │  (Ink)   │  │ (React)  │  │(MultiIM) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
├───────┴─────────────┴─────────────┴─────────────┴──────────┤
│                   TypeScript SDK Layer                       │
│  Agent Orchestrator · Memory Store · Model Router · Tools   │
│  Hooks · Permissions · Scheduler · Skills · Plugins         │
├─────────────────────────────────────────────────────────────┤
│                     Rust Core Layer                          │
│  AST Engine · Search Engine · Diff Engine · Vector Index    │
│  Symbol Resolver · Blackboard · Hook Engine · Tokenizer     │
└─────────────────────────────────────────────────────────────┘
```

### Quick Start

#### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/) >= 1.78
- [pnpm](https://pnpm.io/) >= 9

#### Installation

```bash
# Clone the repository
git clone https://github.com/bytedance/Rookie-Agent.git
cd Rookie-Agent

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test
```

#### Usage

```bash
# Initialize a new task
rookie init --task "Fix the authentication bug"

# Start interactive coding session
rookie code

# Start TUI mode
rookie tui

# Manage memory
rookie memory

# Run with specific model
rookie code --model claude-3-7-sonnet
```

### Packages

| Package | Description | Language |
|---------|-------------|----------|
| [`@rookie/agent-sdk`](./packages/rookie-sdk) | Core SDK with agents, memory, tools, and model routing | TypeScript |
| [`@rookie/agent-cli`](./packages/rookie-cli) | Command-line interface and TUI | TypeScript |
| [`rookie-core`](./crates/rookie-core) | Rust compute engine (AST, search, diff, index) | Rust |
| [`rookie-napi`](./crates/rookie-napi) | N-API bindings for Node.js integration | Rust |
| [`@rookie/eval`](./packages/rookie-eval) | Evaluation harness and benchmark suite | TypeScript |
| [`@rookie/rl`](./packages/rookie-rl) | Reinforcement learning training pipeline | TypeScript |
| [`rookie-web`](./packages/rookie-web) | Web dashboard (React + Vite) | TypeScript |

### Documentation

- [Getting Started Guide](./docs/guide/quick-start.md)
- [API Reference](./docs/api/index.md)
- [Examples](./docs/examples/index.md)
- [Configuration](./docs/guide/settings.md)

### Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### License

Rookie Agent is licensed under the [MIT License](./LICENSE).

---

<a name="中文"></a>
## 中文

### 概述

Rookie Agent 是一款面向软件工程任务的一体化 AI 智能体。它将 **TypeScript 编排层** 与 **Rust 计算引擎** 相结合，提供高性能的代码分析、多智能体协作和智能任务自动化。

### 特性

| 特性 | 描述 |
|------|------|
| 🧠 **多智能体编排** | Coder、Explorer、Reviewer、Architect、Planner、Evaluator —— 多个专业智能体协同工作 |
| 📋 **长任务 harness** | 复杂工作流的会话持久化、进度跟踪和功能验证 |
| 🔄 **自进化技能** | 从使用模式中自动生成和优化技能 |
| 🧩 **结构化记忆** | 情景记忆、语义记忆和用户模型多层记忆架构 |
| 🌐 **多平台支持** | CLI、TUI、Web UI 及网关支持（飞书、Slack、Discord、Telegram、企业微信） |
| 🛠️ **内置工具** | 16+ 工具，支持文件、Shell、Git、Web、Notebook 和 MCP 操作 |
| ⚡ **Rust 核心** | 高性能 AST 解析、代码搜索、差异计算和向量索引 |
| 🔌 **可扩展** | 插件系统、自定义技能、Hooks 和 MCP（Model Context Protocol）支持 |

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   CLI    │  │   TUI    │  │  Web UI  │  │   网关    │   │
│  │ (Node.js)│  │  (Ink)   │  │ (React)  │  │(多IM)    │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
├───────┴─────────────┴─────────────┴─────────────┴──────────┤
│                     TypeScript SDK 层                        │
│  智能体编排 · 记忆存储 · 模型路由 · 工具集                     │
│  Hooks · 权限管理 · 调度器 · 技能系统 · 插件                  │
├─────────────────────────────────────────────────────────────┤
│                       Rust 核心层                             │
│  AST 引擎 · 搜索引擎 · 差异引擎 · 向量索引                     │
│  符号解析 · 黑板系统 · Hook 引擎 · 分词器                      │
└─────────────────────────────────────────────────────────────┘
```

### 快速开始

#### 环境要求

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/) >= 1.78
- [pnpm](https://pnpm.io/) >= 9

#### 安装

```bash
# 克隆仓库
git clone https://github.com/bytedance/Rookie-Agent.git
cd Rookie-Agent

# 安装依赖
pnpm install

# 构建项目
pnpm build

# 运行测试
pnpm test
```

#### 使用

```bash
# 初始化新任务
rookie init --task "修复认证相关的 bug"

# 启动交互式编码会话
rookie code

# 启动 TUI 模式
rookie tui

# 管理记忆
rookie memory

# 使用指定模型运行
rookie code --model claude-3-7-sonnet
```

### 包结构

| 包名 | 描述 | 语言 |
|------|------|------|
| [`@rookie/agent-sdk`](./packages/rookie-sdk) | 核心 SDK，包含智能体、记忆、工具和模型路由 | TypeScript |
| [`@rookie/agent-cli`](./packages/rookie-cli) | 命令行界面和 TUI | TypeScript |
| [`rookie-core`](./crates/rookie-core) | Rust 计算引擎（AST、搜索、差异、索引） | Rust |
| [`rookie-napi`](./crates/rookie-napi) | 用于 Node.js 集成的 N-API 绑定 | Rust |
| [`@rookie/eval`](./packages/rookie-eval) | 评估 harness 和基准测试套件 | TypeScript |
| [`@rookie/rl`](./packages/rookie-rl) | 强化学习训练流水线 | TypeScript |
| [`rookie-web`](./packages/rookie-web) | Web 仪表盘（React + Vite） | TypeScript |

### 文档

- [快速入门指南](./docs/guide/quick-start.md)
- [API 参考](./docs/api/index.md)
- [示例](./docs/examples/index.md)
- [配置说明](./docs/guide/settings.md)

### 贡献指南

我们欢迎贡献！请参阅 [贡献指南](./CONTRIBUTING.md) 了解详情。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 许可证

Rookie Agent 基于 [MIT 许可证](./LICENSE) 开源。

---

<div align="center">

Made with ❤️ by ByteDance

</div>
