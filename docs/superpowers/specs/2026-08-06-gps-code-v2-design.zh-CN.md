# GPS Code V2 设计文档

日期：2026-08-06

## 概要

GPS Code V2 将产品从代码库解释工具重新定位为**完整的 AI coding agent**，同时保留核心差异化：中文优先交互、对国产 OpenAI 兼容模型（DeepSeek、Qwen、Kimi、Ollama）的一流支持，以及**资深工程师导师人格** —— 在改代码的同时解释为什么这么改。

V1 设计稿明确将"强自动代码修改"列为非目标。该约束现已废弃。GPS Code V2 被设计为处理真实的多文件重构任务、长 agent 会话和自主编辑工作流 —— 但它保留了让 M1-M5 异常稳健的安全工程和证据驱动方法。

## 变更内容

**废弃的 V1 非目标**（引自 2026-06-30-gps-code-design.md）：

> "Strong automatic code modification."（第 368 行）

> "不把自动改代码作为主要 MVP 流程。"（第 84 行）

**新定位**：

GPS Code 是面向个人开发者的中文优先 AI coding agent，尤其适合受益于**引导式自动化**的初中级程序员 —— agent 不仅改代码，还用简体中文解释架构推理、常见陷阱和下一步验证步骤。

目标能力：开发者可以把真实任务交给 GPS Code（"把认证重构为使用 JWT"、"给 /users API 加分页"、"从 Vite 迁移到 Next.js"），GPS Code 跨多个文件、提交和测试-修复循环完成任务，同时教会开发者它做了什么以及为什么。

## 保留内容

**V1 的保留原则**：

- **证据驱动的回答**：永远不在没有引用具体文件、函数或配置的情况下声称确定性。
- **提议/确认作为默认模式**：安全模型变成**模式系统**（default-confirm / auto-accept-edits / read-only / plan）而非绝对约束。用户可以为大型重构选择自主编辑，但默认会先询问。
- **带过期检测的原子写入**：M5 的编辑引擎（临时文件 + fsync + rename/link，提交前 sha256 重新校验，多文件回滚）是生产级资产。不要削弱它。
- **Argv 而非 shell 的命令执行**：`shell: false` + argv 数组让权限策略变成结构化匹配而非正则猜测 shell 字符串。
- **工作区路径限制**：所有文件操作留在工作区根目录内；`resolveWorkspacePath` + `realpath` 阻止符号链接逃逸。
- **中文优先交互**：所有面向用户的文本（TUI、提示、确认词、错误消息）用简体中文。代码注释和抛出的 `Error` 消息用英文。
- **导师人格**：系统提示的"结论 / 依据 / 讲解 / 注意 / 下一步"结构保留。GPS Code 解释它改了什么以及为什么，而不只是"我应用了编辑"。

## 目标架构

| 组件 | 职责 | 状态 | 模块 |
|------|------|------|------|
| **Agent Session** | 持久对话状态，跨轮消息累积，工具循环（20+ 轮），取消 | **需重构** | `agent/agent.ts` → `AgentSession` 类，`agent/types.ts` |
| **权限系统** | 四档模式策略（default-confirm / auto-accept-edits / read-only / plan），危险命令分类（allow/confirm/strong-confirm/block），allowlist/denylist | **新增** | `permissions/policy.ts`, `permissions/types.ts` |
| **上下文管理** | Token 计数，历史压缩（保留最近 N 轮，摘要更早的），工具结果截断，repo map 增量更新 | **新增** | `agent/agent.ts`, `model/token-counter.ts`（新） |
| **编辑引擎** | 带过期检测的原子应用，一级撤销，exact-unique-match + whole-file 模式 | **已存在**（M5） | `edits/*.ts` — 保留所有安全属性 |
| **编辑能力** | 20 文件/50 操作（从 5/20 提升），delete、rename、多级 undo | **需扩展** | `edits/types.ts`, `edits/apply.ts`, `edits/undo.ts` |
| **命令执行器** | Argv + `shell:false`，超时，输出截断，工作区限定 cwd | **已存在**（M4） | `commands/runner.ts` — 加策略门控 |
| **工具注册表** | 单源 schema（zod → JSON Schema 自动生成），弱模型的 tool-calling 降级 | **需重构** | `tools/registry.ts` |
| **模型客户端** | OpenAI 兼容 fetch，流式，重试/backoff，多模型路由（搜索用便宜模型，编辑用强模型） | **需扩展** | `model/openai-compatible.ts` |
| **TUI** | 基于 Ink，流式输出，中断，首次运行引导 | **需扩展** | `tui/App.tsx`, `tui/components/*.tsx` |
| **工作区索引器** | JS/TS、Python、Java、C/C++ 的 RepoMap | **已存在**（M1-M2） | `workspace/indexer.ts`, `workspace/languages/*.ts` |
| **Git 集成** | 只读 diff（已有），自动 stage/commit（新） | **部分存在** | `git/diff.ts`, `git/stage.ts`（M11 新增） |
| **项目配置** | GPS.md 解析，MCP 客户端，hooks | **新增**（M12） | `workspace/gps-md.ts`, `mcp/client.ts`, `hooks/runner.ts` |

## 路线图修订（2026-08-06，M6/M7 交付后）

下面的路线图写于实施之前。实际交付的内容与之有差异，这里记录修订而不是悄悄改掉：

- **实际交付的 M6** 包含 `AgentSession` 重构、工具结果截断、repo map 只发一次，
  以及权限系统的*基础设施* —— 但四档模式是无效的，黑名单可以通过 `/run` 绕过。
- **因此实际交付的 M7 是「权限模式」**，不是下面写的「编辑能力扩展」：它让四档模式
  真正改变行为，通过在 `runCommand()` 内部强制策略堵住了 `/run` 绕过，并加上了状态栏
  指示器。详见 `plans/2026-08-06-gps-code-m7-permission-modes.md`，那份文档也记录了
  它第一版中三处不实的声明。
- **下面从 M7 开始的所有编号顺延一位。**「编辑能力扩展」变成 M8；「完整黑名单 +
  Tool-calling 降级」的黑名单部分并入 M8，降级部分并入 M9。
- **取消功能仍未完成。** `AgentSession.cancel()` 和 `AbortController` 存在，但没有
  `AbortSignal` 传到 `fetch`，也没有按键处理去调 `cancel()`。它列在 M6 范围内但没有交付。
  注意 `InputBox` 已经占用了 Ink 的 `useInput`，接 Ctrl-C 需要小心。

下面各里程碑的*内容*仍然有效，但 M6 之后的*编号*要顺延一位来读。

## 长期路线图：M6-M12

### M6 — Agent Session + 权限模式 + 轻量上下文管理

**目标**：支持多轮编码任务，为大型重构提供 auto-accept-edits 模式，防止上下文窗口爆炸。

**为什么是 M6**：Session 状态是地基。每延迟一个里程碑，返工量就翻倍。权限模式立刻解锁"接 30 文件重构任务"。没有上下文管理，M6 建的 session 会在 10 轮内死掉。

**范围内**：
- `AgentSession` 类：持久 `messages`，`ask()` 追加而非重建，`maxToolRounds` → 20
- `App.tsx` 启动时创建一次 session，后续 submit 复用
- 四档权限模式：`default-confirm` / `auto-accept-edits` / `read-only` / `plan`
- 危险命令黑名单（基础版）：`rm -rf`、`git push --force/-f`、`git reset --hard`
- 工具结果截断：content > 2000 tokens → 保留头尾 + "..."
- Repo map：首轮完整 JSON，后续占位符或跳过
- 中断：`AbortController` + Ctrl-C 绑定

**范围外**：历史压缩（M9）、完整黑名单（M8）、tool schema 自动生成（M10）、流式输出（M9）

**文件**：
- `src/agent/agent.ts` — 大重构
- `src/agent/types.ts` — 新增
- `src/tui/App.tsx` — 中等重构
- `src/permissions/policy.ts` — 新增
- `src/permissions/types.ts` — 新增
- `src/commands/runner.ts` — 小改（入口调策略）
- `tests/permissions/policy.test.ts` — 新增
- `tests/agent/agent.test.ts` — 大重构

**验收标准**：
1. 跨 5 轮对话，模型能引用第 1 轮读过的文件内容
2. `auto-accept-edits` 模式：10 个连续编辑提议自动应用，无需 10 次确认
3. `read-only` 模式：编辑和命令提议被拒绝
4. `plan` 模式：编辑和命令被拒绝，只能读
5. `rm -rf /` 被 block
6. `git push --force` 被 block
7. 大仓库（1000+ 文件）：第 2 轮不重发完整 repo map（检查消息数组长度）
8. Ctrl-C 中断进行中的模型调用
9. 工具结果超 2000 tokens 被截断（检查 "..." 或 "[truncated]"）

**风险**：Session 状态 bug。需要 M5 全量回归。

---

### M7 — 编辑能力扩展

**目标**：支持真实重构任务需要的 delete、rename、更高上限、whole-file 模式。

**为什么是 M7**：M6 建了 session，但 5 文件/20 操作上限立刻杀死真实任务。必须紧跟 M6。

**范围内**：
- `MAX_EDIT_FILES` 20，`MAX_EDIT_OPERATIONS` 50
- `action: 'delete'`：备份到 `.gps-code-<name>-<uuid>.deleted`，undo 还原
- `action: 'rename'`：需要 `newPath`，检查目标不存在
- Whole-file-rewrite：`oldText` 为空 + `action='update'` → `newText` 是完整内容（配合 `expectedHash` 检查）
- 保留 exact-unique-match 作为默认（最稳健）

**范围外**：多级 undo（M11）、git 自动 stage（M11）、binary/symlink（永久 out of scope）

**文件**：
- `src/edits/types.ts`、`src/edits/proposal.ts`、`src/edits/apply.ts`、`src/edits/undo.ts` — 中等改动
- `src/tools/propose-file-edits.ts` — 小改
- `src/tools/registry.ts` — 小改（JSON Schema 同步）
- `tests/edits/*.test.ts`、`tests/acceptance/safe-edits.test.ts` — 改动

**验收标准**：
1. 提议 delete 3 + rename 2 + update 15 文件，一次确认全部应用
2. Whole-file 模式重写 500 行文件成功
3. Delete undo 还原文件
4. Rename undo 还原原文件名
5. 所有 M5 安全属性通过：staleness 拒绝、原子写、回滚

**风险**：Delete/rename undo 边界情况（rename 后文件又被改）。

---

### M8 — 完整黑名单 + Tool-calling 降级

**目标**：填补安全缺口，让国产弱模型可用。

**为什么是 M8**：M6-M7 后用户开始真用。安全和模型兼容必须立刻补上。

**范围内**：
- 黑名单：`chmod -R`、`chown -R`、`npm/pnpm/yarn/bun install -g`、迁移命令（`django-admin migrate`、`rails db:migrate`、`prisma migrate deploy`、`flyway migrate`）
- Strong-confirm：要求输入命令本身或"确认删除"，不是 `y`
- Tool-calling 降级：捕获格式错误，fallback 到"模型未能正确调用工具，请用自然语言描述你的发现"
- Config allowlist/denylist（`config.json` 加字段）

**范围外**：多模型路由（M11）、MCP（M12）

**文件**：
- `src/permissions/policy.ts` — 中等改动
- `src/permissions/types.ts` — 小改
- `src/config/schema.ts` — 小改
- `src/agent/agent.ts` — 小改（降级逻辑）
- `src/model/openai-compatible.ts` — 小改
- `src/tui/App.tsx` — 中等改动（strong-confirm 流程）
- `src/tui/command-confirmation.ts` — 小改
- `tests/permissions/*.test.ts` — 改动

**验收标准**：
1. `chmod -R 777 /` 被 block
2. `npm install -g pkg` 触发 strong-confirm，`y` 被拒，输入命令通过
3. Allowlist `["pnpm test"]` 自动放行 `pnpm test`
4. Qwen-Turbo（弱 tool-calling）通过降级完成基本对话

**风险**：黑名单不完整（文档必须说明"不保证拦截所有风险"）。

---

### M9 — 历史压缩 + 流式输出 + Token 计数

**目标**：长会话不爆，长回答体验好。

**为什么是 M9**：M6 建了持久会话，M7-M8 用户开始真用 → 长会话爆炸问题暴露。

**范围内**：
- 历史压缩：保留最近 5 轮完整，更早的只保留 user + assistant 最终回答（丢工具调用细节）
- `tiktoken` 或 `js-tiktoken` 做 token 计数，追加前检查预算（假设 32K 上下文，留 8K buffer）
- 流式输出：`openai-compatible.ts` 检测 `response.body.getReader()`，解析 SSE，逐块 yield
- TUI 订阅流事件，实时渲染
- 中断流：`AbortController` 停止流

**范围外**：prompt caching（M11，依赖提供商支持）

**文件**：
- `src/agent/agent.ts` — 中等改动
- `src/model/openai-compatible.ts` — **大改动**
- `src/model/types.ts` — 小改
- `src/tui/App.tsx` — 中等改动
- `package.json` — 加 `js-tiktoken`

**验收标准**：
1. 20 轮对话后，`session.messages` 保留 5 轮完整 + 15 轮摘要
2. Token 溢出触发自动压缩
3. 长回答逐字渲染，不是 10 秒卡顿
4. Ctrl-C 停止流，保留已渲染内容

**风险**：压缩可能丢关键上下文（第 3 轮读文件，第 15 轮引用）。显示"已压缩 N 轮"警告。

---

### M10 — Tool Schema 单源 + 首次运行引导

**目标**：清理技术债，降低新手门槛。

**为什么是 M10**：M6-M9 修核心能力，技术债累积了。现在清理，为后面扩展工具铺路。

**范围内**：
- 用 `zod-to-json-schema` 从 zod 自动生成 JSON Schema，删掉 `toolParameterSchemas` 手写部分
- 首次运行检测 `~/.gps-code/config.json` 不存在 → TUI 显示交互式表单
- Preset 选择（TUI 列出 DeepSeek / Qwen / Kimi / Ollama，用户选一个）

**范围外**：多模型路由（M11）、GPS.md（M11）

**文件**：
- `src/tools/registry.ts` — **大改动**
- `src/cli/commands.ts` — 小改
- `src/tui/App.tsx` — 中等改动
- `src/tui/components/ConfigForm.tsx` — **新增**
- `package.json` — 加 `zod-to-json-schema`

**验收标准**：
1. 改 `read_file` zod schema（`maxBytes` → 128000），JSON Schema 自动同步
2. 新用户首次运行，TUI 引导配置 DeepSeek
3. 所有工具 schema 一致性测试通过

**风险**：`zod-to-json-schema` 输出可能有细微差异。需全工具回归。

---

### M11 — 多模型路由 + 多级 Undo + Git 集成

**目标**：降成本，增强可逆性，深度 git 集成。

**为什么是 M11**：核心能力完整，优化成本（多模型）和体验（多级 undo、git）。

**范围内**：
- `config.json` → `{default: ModelConfig, search?: ModelConfig, edit?: ModelConfig}`，agent 按阶段选模型
- Undo 历史持久化到 `~/.gps-code/undo-stack.json`，3-5 级
- 编辑后自动 `git add`，可选自动 commit（`config.json` 加 `autoCommit: boolean`）

**范围外**：自动 PR（永久 out of scope）、子代理（M12）

**文件**：
- `src/config/schema.ts` — 中等改动
- `src/agent/agent.ts` — 小改
- `src/edits/undo.ts` — 中等改动
- `src/git/stage.ts` — **新增**
- `src/tui/App.tsx` — 小改

**验收标准**：
1. 配置 `search`: Qwen-Turbo，`edit`: DeepSeek-V2.5 → agent 自动切换
2. 5 次编辑后，`/undo` 回退 1 次，`/undo 3` 回退 3 次
3. 编辑应用后，`git status` 显示文件已 staged

**风险**：阶段判定不准（搜索阶段突然要改文件）→ fallback 到 `default`。

---

### M12 — 项目级配置 + MCP 客户端 + Hooks

**目标**：扩展性，让 GPS Code 适配项目特殊需求。

**为什么是 M12**：核心能力 + 体验优化都完成，开放扩展接口。

**范围内**：
- GPS.md 解析（类似 CLAUDE.md）：项目根目录 GPS.md → 注入到 system message
- MCP 客户端：连接本地 MCP server，扩展工具集
- Hooks：`pre-edit` / `post-edit` / `pre-command` / `post-command`，在 `.gps-code/hooks/` 放脚本

**范围外**：子代理（需要更复杂并发控制，可能 M13）

**文件**：
- `src/workspace/gps-md.ts` — **新增**
- `src/mcp/client.ts` — **新增**
- `src/hooks/runner.ts` — **新增**
- `src/agent/agent.ts` — 小改
- `src/tui/App.tsx` — 小改

**验收标准**：
1. `GPS.md` 写"Django 项目，测试命令 `python manage.py test`" → agent 体现此信息
2. 连接本地 MCP server（提供 `database_query` 工具）→ agent 能调用
3. `.gps-code/hooks/pre-edit.sh` 存在 → 编辑前执行，非零退出码拒绝编辑

**风险**：MCP 协议版本兼容，hook 安全性（文档必须警告"hook 执行任意代码"）。

---

## 排序逻辑

1. **M6 最紧急**：Session 是地基，越晚改返工量越大。权限模式是"能接真实任务"前提。
2. **M7 紧跟**：不然"能接任务"是空话（5 文件上限卡死）。
3. **M8 补安全和兼容**：用户开始真用，这两个兜底必须有。
4. **M9 补体验**：长对话爆炸、等待体验差暴露，必须修。
5. **M10 清债**：技术债不清，后面扩展工具越来越痛苦。
6. **M11-M12 锦上添花**：核心能力已全，这些是优化和扩展。

## V2 成功标准

GPS Code V2 可以公开发布当：

1. 开发者可以交给 GPS Code 一个 **30 文件 TypeScript 重构**（"所有 class 组件转 hooks"），在 `auto-accept-edits` 模式确认一次，GPS Code 完成并解释每批改动。
2. 大仓库上的 **20 轮调试会话**不撞上下文上限或丢失早期证据。
3. `rm -rf`、`git push --force`、全局安装**默认被 block**，有清晰解释。
4. 新用户首次运行 `gps-code`，**在 TUI 内完成模型配置**无需读文档。
5. 所有 **M1-M5 安全属性**仍通过：staleness 拒绝、原子写、回滚、exact-unique-match、工作区限制。
6. GPS Code 能用 **Qwen-Turbo 和早期 Kimi 模型**（弱 tool-calling）通过降级工作，不只是 DeepSeek-V2.5。
7. **导师人格**保持可见：多文件编辑后，GPS Code 解释"为什么这么改"和"下一步应该验证什么"，不只是"我应用了 15 个编辑"。

## 差异化锚点

**将 GPS Code 定位为想要学习而非只是委托的开发者的 AI coding agent。**

其他所有 agent（Claude Code、Aider、Cline、Cursor）把代码修改当黑盒：模型改文件，用户审查 diff。GPS Code 独特地结合了自主能力与**教学透明度**：它解释每个改动背后的架构推理，警告边界情况，建议验证命令 —— 全用用户母语。

这对初中级开发者尤其有价值，他们最受益于理解重构*为什么*有效，而不只是看到它编译了。

中文优先 + 国产模型优化的定位在**可及性和成本**上差异化，而导师人格在**学习价值**上差异化。两者共同定义了一个目前无竞争对手占据的楔子。
