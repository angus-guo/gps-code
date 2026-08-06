# GPS Code

GPS Code 是一款中文优先的 TUI code agent，面向个人开发者，尤其适合初中级程序员理解陌生代码库。

产品定位：

- 在项目目录中运行 `gps-code`
- 支持 OpenAI-compatible 模型配置
- 支持 DeepSeek、Qwen、Kimi、Ollama 等兼容服务
- 自动生成轻量 repo map
- 优先适配 JS/TS、Python、Java、C/C++
- 用资深软件工程师风格解释项目结构、启动方式、入口文件和关键模块

## 已有能力

**项目理解**：启动时扫描工作区，识别语言、框架、包管理器、构建工具、npm scripts、关键文件与目录，作为回答的初始证据。

**按需检索**：模型可调用 `list_files`、`read_file`、`search_text` 三个只读工具补充证据（搜索优先使用本地 `rg`，不可用时回退到内置实现）。工具调用过程会实时显示在 TUI 中。

**命令协助**：模型通过 `propose_command` 提议命令，TUI 展示后等待确认才执行。命令以 argv 数组方式运行，不经过 shell，带超时与输出截断；执行完由模型总结结果，并展示工作区 git diff 摘要。

**安全编辑**：模型通过 `propose_file_edits` 提出精确文本替换，TUI 展示 diff 预览后等待确认才写入。编辑基于 sha256 校验，落盘前会重新核对文件内容，中途被修改则判定为过期并拒绝应用；写入经临时文件原子提交，多文件失败时逆序回滚。

**撤销**：`/undo` 可撤销最近一次成功应用的编辑（仅保留一级）。若文件在应用后又被改动，撤销会被拒绝。

## 开发

需要 Node.js 20 及以上。

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## 配置模型

```bash
gps-code config:set \
  --base-url https://api.deepseek.com \
  --api-key "$DEEPSEEK_API_KEY" \
  --model deepseek-chat
```

配置写入 `~/.gps-code/config.json`（权限 0600）。查看内置 preset：

```bash
gps-code config:presets
```

查看当前配置（API key 会被掩码）：

```bash
gps-code config:show
```

## 启动

```bash
gps-code
```

TUI 内可用：

- 直接输入中文问题，回车发送
- `/run <命令>` 手动提议一条命令
- `/undo` 撤销最近一次编辑
- 确认命令：`y` / `yes` / `确认` / `执行` / `run`
- 确认编辑：`y` / `yes` / `确认` / `应用` / `apply`
- 取消：`n` / `no` / `取消` / `cancel`

## 安全模型

只读操作（列目录、读文件、搜索、生成 repo map）自动执行；运行命令和修改文件一律先提议、由用户确认后才生效。模型本身没有直接写文件或执行命令的通道。

需要注意：当前版本**尚未实现危险命令黑名单**。命令只要用户确认就会执行，GPS Code 不会对 `rm -rf`、`git push --force`、数据库迁移等高风险操作做额外拦截。确认前请自行判断。

## 当前状态

M1-M5 已完成：可配置 TUI 对话、项目理解、只读工具检索、命令确认执行、安全编辑与撤销。

已知缺口：

- 危险命令拦截层尚未实现（见上）
- 会话历史不落盘，退出后丢失
- 首次运行不会引导配置，需先在命令行执行 `config:set`
- 编辑能力不覆盖删除、重命名、二进制文件与符号链接
- P1 语言（Go、Rust、PHP、C#、Kotlin）尚未支持

设计文档见 `docs/superpowers/specs/`，各里程碑实施计划见 `docs/superpowers/plans/`。
