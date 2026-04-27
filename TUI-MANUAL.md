# Rookie Agent TUI 说明书

> Terminal User Interface Manual — Ink 7 + React 19

---

## 目录

1. [概览](#概览)
2. [界面布局](#界面布局)
3. [模式系统](#模式系统)
4. [键盘快捷键](#键盘快捷键)
5. [输入系统](#输入系统)
6. [事件流](#事件流)
7. [审批系统](#审批系统)
8. [命令系统](#命令系统)
9. [组件架构](#组件架构)
10. [优化特性](#优化特性)

---

## 概览

Rookie Agent TUI 是一个基于 **Ink 7 + React 19** 构建的终端用户界面，为 Rookie Agent CLI 提供丰富的交互体验。它采用响应式布局，支持多种视图模式、键盘驱动操作、实时事件流和智能审批工作流。

**技术栈：**

| 层级 | 技术 |
|------|------|
| 渲染引擎 | Ink 7 (React for CLI) |
| UI 框架 | React 19 (hooks-only, no classes) |
| 构建工具 | tsup + esbuild |
| 模块系统 | ESM (.js 扩展名导入) |
| 语言 | TypeScript (strict mode) |

---

## 界面布局

TUI 采用经典的三区域布局，所有区域自适应终端窗口大小（含防抖处理）。

```
╭─── TopStatusBar ──────────────────────────────────────╮
│  Model: gpt-4o │ Session: 5m │ ⚡ 1.2k tokens │ $0.02 │
╰───────────────────────────────────────────────────────╯
┌ ModeTab ──────────────────────────────────────────────┐
│ [Chat] Plan  Diff  Logs  Review                       │
└───────────────────────────────────────────────────────┘
┌ MainContent ──────────────────────┬─ Sidebar ─────────┐
│                                   │ Context            │
│  Event Stream / Plan / Diff /     │  📂 src/app.tsx    │
│  Logs / Approval Panel            │  📂 lib/utils.ts   │
│                                   │                    │
│  (Help Panel overlay when ? key)  │ Active Files       │
│                                   │  ✏️ config.json    │
│                                   │                    │
└───────────────────────────────────┴────────────────────┘
╭─── InputPanel ────────────────────────────────────────╮
│ ❯ Type a message or /command... (Alt+Enter for new line) │
╰───────────────────────────────────────────────────────╯
┌ BottomBar ────────────────────────────────────────────┐
│ ⠋ Processing... │ Ctrl+C: interrupt │ ↑↓: scroll │ ?: help │
└───────────────────────────────────────────────────────┘
```

### 尺寸分配

| 区域 | 高度 | 说明 |
|------|------|------|
| TopStatusBar | 1 行 | 模型名、会话时长、Token 用量、费用 |
| ModeTab | 1 行 | 模式切换标签页 |
| MainContent | 自适应 | `rows - chrome` (chrome = top + tabs + input + bottom) |
| InputPanel | 3-10 行 | 单行 3 行（含边框），多行自动增长至最多 8 行内容 |
| BottomBar | 1 行 | 上下文键位提示、处理状态 |

### 侧边栏

侧边栏宽度：`max(28, min(38, floor(cols × 0.25)))`，显示：

- **工作区上下文**：当前目录、Git 分支、脏文件数
- **最近文件**：读取过的文件列表
- **活跃文件**：本会话中写入/编辑的文件
- **任务统计**：已完成/待处理任务数

---

## 模式系统

TUI 支持 6 种视图模式，通过数字键或 `/` 命令切换：

| 模式 | 快捷键 | 提示符 | 说明 |
|------|--------|--------|------|
| **Chat** | `1` / Esc | `❯` (绿) | 默认模式，事件流 + 对话 |
| **Plan** | `2` / `/plan` | `◆` (青) | 计划视图，显示步骤状态 |
| **Diff** | `3` / `/diff` | `±` (黄) | 文件差异对比 |
| **Logs** | `4` / `/logs` | `▪` (灰) | 工具执行日志 |
| **Review** | `5` | `◎` (品红) | 代码审查 |
| **Approve** | `/approve` | `!` (黄) | 审批待处理项 |

**模式切换规则：**
- `Esc` 返回 Chat 模式
- 在 Chat 模式下，`Esc` 切换焦点到事件流（取消输入焦点）
- 再次 `Esc` 退出应用

---

## 键盘快捷键

按 `?` 键可在 TUI 内打开快捷键帮助面板。

### 全局

| 按键 | 功能 |
|------|------|
| `Enter` | 发送消息 / 展开/折叠事件 |
| `Alt+Enter` | 插入换行（多行输入） |
| `Ctrl+C` | 处理中 → 中断；空闲 → 双击退出 |
| `Ctrl+L` | 清屏 |
| `Esc` | 返回 Chat / 切换焦点 / 退出 |
| `?` | 切换帮助面板（非输入焦点时） |
| `Tab` | 补全命令建议 / 循环选择 |
| `Shift+Tab` | 反向循环命令建议 |

### 导航（非输入焦点 / 处理中）

| 按键 | 功能 |
|------|------|
| `j` / `↓` | 向下滚动 / 下一项 |
| `k` / `↑` | 向上滚动 / 上一项 |
| `PageDown` | 向下翻 5 项 |
| `PageUp` | 向上翻 5 项 |
| `G` | 跳到最新事件（恢复自动跟随） |
| `Space` / `Enter` | 展开/折叠事件详情 |
| `d` | 切换到 Diff 视图 |
| `l` | 切换到 Logs 视图 |

### 输入

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 浏览输入历史（无建议弹出时） |
| `←` / `→` | 移动光标 |
| `Backspace` | 删除光标前字符 |
| `Delete` | 删除光标后字符 |
| `/` | 进入命令模式（显示建议列表） |
| `r` | 重新发送上一条消息 |

### 审批

| 按键 | 功能 |
|------|------|
| `a` | 批准选中项 |
| `x` | 拒绝选中项 |

---

## 输入系统

### 单行输入

默认模式，输入框高度固定 3 行（上下边框 + 1 行内容）。支持：

- **CJK 字符宽度感知**：正确计算中日韩字符的显示宽度
- **长文本滚动窗口**：超出显示宽度时，围绕光标位置自动裁剪，头尾显示 `…`
- **IME 定位**：通过 Ink 的 `useCursor` + Yoga 布局树精确定位输入法候选窗

### 多行输入 (TUI-OPT-3)

按 **Alt+Enter** 插入换行，支持：

- 输入框动态增高（最多 8 行内容，总高度 3-10 行）
- 行号指示：首行显示模式提示符 `❯`，续行显示 `·`
- 光标跨行移动：光标正确跟踪当前行和列
- 超长内容时显示行位置指示器 `[当前行/总行数]`
- 主内容区高度自动调整（layout chrome 值动态计算）

### 命令补全

输入 `/` 开头触发命令建议列表：

- 实时过滤匹配
- `Tab` 接受当前选中建议
- `↑`/`↓` 在建议列表中导航
- `Shift+Tab` 反向循环

### 输入历史

- `↑`/`↓` 键（无命令建议时）浏览历史输入
- 历史记录存储在 `useTuiState` 中

---

## 事件流

事件流是 Chat 模式的核心显示区域，采用结构化分层展示：

### 事件类型

| 类型 | 图标 | 说明 |
|------|------|------|
| `intent` | 🗆 | Agent 思考过程（thinking） |
| `action` | ⚙ | 工具调用 |
| `result` | 🗇 | 工具执行结果 |
| `error` | ❌ | 错误信息 |
| `system` | (无) | 系统消息 |
| `user` | (无) | 用户输入 |

### 信息层级

遵循 P0-P3 优先级架构：

| 优先级 | 内容 | 显示策略 |
|--------|------|----------|
| **P0** | 决策/错误 | 始终可见，高亮显示 |
| **P1** | 状态/结果 | 默认可见 |
| **P2** | 日志详情 | 默认折叠，点击展开 |
| **P3** | 历史记录 | 滚动查看 |

### Markdown 内联样式 (TUI-OPT-1)

事件内容支持基础 Markdown 渲染：

- `**加粗**` → **加粗**显示
- `` `代码` `` → 高亮代码片段
- `[链接](url)` → 蓝色下划线文本

### 滚动与自动跟随

- **自动跟随**：新事件到来时自动滚动到底部
- **手动滚动**：`j`/`k`/`PageUp`/`PageDown` 中断自动跟随
- **恢复跟随**：按 `G` 跳到最新并恢复自动跟随
- **滚动位置指示器**：显示当前位置 / 总事件数

---

## 审批系统

当 Agent 调用高危工具时自动触发审批：

### 危险工具分类

| 工具 | 风险等级 | 说明 |
|------|----------|------|
| `shell_execute` | 🔴 高 | Shell 命令执行 |
| `file_write` | 🟡 中 | 文件写入 |
| `file_edit` | 🟡 中 | 文件编辑 |

### 审批流程

1. Agent 调用危险工具 → 自动创建审批请求
2. 审批面板显示工具名、参数、风险等级
3. 用户按 `a` 批准或 `x` 拒绝
4. 结果通过 `onApprovalResponse` 回调传递给 Agent

### 审批状态

| 状态 | 说明 |
|------|------|
| `pending` | 等待用户决定 |
| `approved` | 已批准 |
| `rejected` | 已拒绝 |
| `edited` | 已编辑后批准 |

---

## 命令系统

在输入框输入 `/` 开头的命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有可用命令 |
| `/clear` | 清空事件流 |
| `/status` | 显示当前状态摘要 |
| `/plan` | 切换到计划视图 |
| `/diff` | 切换到差异对比视图 |
| `/logs` | 切换到日志视图 |
| `/context` | 显示上下文摘要（发送给 Agent） |
| `/commit` | 准备提交信息（发送给 Agent） |
| `/tests` | 运行测试（发送给 Agent） |
| `/approve` | 切换到审批视图 |

**注意**：`/context`、`/commit`、`/tests` 会将对应指令作为消息发送给 Agent 处理，其余命令在 TUI 本地执行。

---

## 组件架构

### 组件树

```
App (app.tsx)
├── TopStatusBar          # 模型、会话时长、Token、费用
├── ModeTab               # 模式标签切换
├── Box [主区域]
│   ├── Box [内容区]
│   │   ├── EventStream   # 事件流（Chat 模式）
│   │   ├── PlanPanel     # 计划视图（Plan 模式）
│   │   ├── DiffPanel     # 差异对比（Diff 模式）
│   │   ├── LogPanel      # 日志列表（Logs 模式）
│   │   ├── ApprovalPanel # 审批面板（Approve 模式）
│   │   ├── HelpPanel     # 快捷键帮助（? 键叠加层）
│   │   └── ErrorDisplay  # 错误展示
│   └── Box [侧边栏]
│       └── ContextPanel  # 上下文信息
├── CommandSuggestions     # 命令补全弹出框
├── InputPanel            # 输入面板（支持多行）
└── BottomBar             # 底部状态栏 + 键位提示
```

### 文件清单

| 文件 | 行数 | 职责 |
|------|------|------|
| `app.tsx` | 530 | 根组件，状态管理，键盘处理，事件消费 |
| `types.ts` | 167 | 类型定义、颜色常量、按键绑定 |
| `hooks/useTuiState.ts` | 243 | 核心状态 Hook（事件、审批、计划、文件追踪） |
| `components/EventStream.tsx` | 416 | 事件流渲染、Markdown 内联、滚动指示器 |
| `components/InputPanel.tsx` | 229 | 输入面板、多行支持、CJK 宽度、IME 定位 |
| `components/BottomBar.tsx` | 128 | 动态键位提示、Token 速率、Braille 旋转动画 |
| `components/HelpPanel.tsx` | 133 | 键盘快捷键帮助叠加层 |
| `components/TopStatusBar.tsx` | 88 | 顶部状态栏 |
| `components/ModeTab.tsx` | 77 | 模式标签页 |
| `components/ApprovalPanel.tsx` | 140 | 审批面板 |
| `components/ContextPanel.tsx` | 119 | 侧边栏上下文 |
| `components/DiffPanel.tsx` | 142 | 差异对比视图 |
| `components/LogPanel.tsx` | 118 | 日志面板 |
| `components/PlanPanel.tsx` | 97 | 计划视图 |
| `components/ErrorDisplay.tsx` | 88 | 错误展示 |
| `components/CommandSuggestions.tsx` | 60 | 命令补全弹框 |

---

## 优化特性

以下是 TUI 优化（TUI-OPT）系列实现的特性：

### TUI-OPT-1: Markdown 内联样式
事件流中的 LLM 响应支持 `**bold**`、`` `code` ``、`[link](url)` 内联 Markdown 渲染，提升可读性。

### TUI-OPT-2: PageUp/PageDown 翻页
在非输入焦点下支持 `PageUp`/`PageDown` 快速翻页（每次 5 条事件），在 Diff/Logs 视图中同样生效。

### TUI-OPT-3: 多行输入
通过 `Alt+Enter` 插入换行，InputPanel 动态增高（最多 8 行），支持续行指示符 `·` 和行位置指示器。

### TUI-OPT-4: Tab 循环补全
在命令建议列表中，`Tab` 前进、`Shift+Tab` 后退、`↑`/`↓` 导航、`Enter` 确认。

### TUI-OPT-5: 动态键位提示
BottomBar 根据当前模式和处理状态显示不同的键位提示，处理中显示中断提示，空闲时显示导航提示。

### TUI-OPT-6: Token 速率追踪
BottomBar 实时显示 `tokens/sec`，通过 delta tokens / delta time 计算。

### TUI-OPT-7: 窗口大小防抖
自定义 `useDebouncedWindowSize(100)` Hook，100ms 防抖延迟，防止快速调整窗口大小时界面频繁重绘。

### TUI-OPT-8: 双击 Ctrl+C 退出确认
- 处理中 → 第一次 `Ctrl+C` 中断当前任务
- 空闲时 → 第一次 `Ctrl+C` 显示 "Press Ctrl+C again to exit" 提示
- 2 秒内再按 `Ctrl+C` 退出，超时自动恢复 "Ready" 状态

### TUI-OPT-9: Braille 旋转动画
处理中底部栏显示 Braille 字符动画 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`（80ms 间隔），提供视觉活动指示。

### TUI-OPT-10: 帮助面板
按 `?` 键（非输入焦点时）切换帮助面板叠加层，显示按模式分组的完整快捷键列表。按 `Esc` 或再按 `?` 关闭。

---

## 颜色语义

| 用途 | 颜色 | 示例 |
|------|------|------|
| 普通文字 | 白色 | 事件标题 |
| 暗淡文字 | 灰色 | 占位符、次要信息 |
| 边框 | 灰色 | 面板边框 |
| 系统 | 青色 | 系统消息、模式标签 |
| 链接 | 蓝色 | URL 链接 |
| 成功 | 绿色 | 工具完成、用户输入 |
| 警告 | 黄色 | 审批、风险提示 |
| 错误 | 红色 | 错误消息 |
| 严重 | 亮红色 | 致命错误 |
| 工具名 | 品红色 | 工具调用名称 |

---

## 快速开始

```bash
# 构建项目
pnpm build

# 运行 CLI（进入 TUI）
node packages/rookie-cli/dist/index.js

# 常用操作
# 1. 输入消息并按 Enter 发送
# 2. 按 ? 查看快捷键
# 3. 按 Alt+Enter 输入多行内容
# 4. 输入 /help 查看所有命令
# 5. 按 Ctrl+C 中断正在执行的任务
# 6. 按 Ctrl+C 两次退出 TUI
```

---

*Generated for Rookie Agent TUI v0.1.0 — Ink 7 + React 19*
