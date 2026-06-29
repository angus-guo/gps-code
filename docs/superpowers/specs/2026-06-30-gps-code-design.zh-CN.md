# GPS Code 设计文档

日期：2026-06-30

## 概要

GPS Code 是一款中文优先、开源的 TUI code agent，面向个人开发者使用。它运行在本地项目目录中，帮助用户像咨询一位资深软件工程师一样理解、导航和分析陌生代码库。

第一版优先做好代码库讲解和导航，而不是追求完整自动化。它应该帮助初中级开发者回答这些问题：

- 这个项目是什么？
- 我该如何启动、构建或测试它？
- 项目入口在哪里？
- 某个具体功能是在哪里实现的？
- 这个函数、类、文件或模块做了什么？
- 这些代码为什么可能会这样设计？
- 下一步我应该验证什么？

GPS Code 应该给人专业、耐心、证据充分、务实可靠的感觉。它不应该只是把代码翻译成中文，而应该解释架构、实现意图、语言语法、常见工程约定和潜在风险，帮助用户真正变成更好的开发者。

## 产品定位

GPS Code 是一款运行在本地终端中的个人开发者产品。它面向希望获得中文友好体验、同时更好支持国内和开源模型生态的用户，可以视为 Claude Code 这类工具的中文优先替代方向。

产品重点包括：

- 高质量中文交互和中文解释。
- 支持 OpenAI-compatible 模型接入。
- 友好支持国内和本地模型，包括 DeepSeek、Qwen、Kimi、GLM、豆包、Ollama 以及其他兼容服务。
- 工具调用和文件依据透明可见。
- 安全的半自动行为。
- 对初中级程序员有很强的指导和辅助价值。

第一版不应该试图完整复刻 Claude Code 的所有能力。它的核心价值是让陌生项目更容易理解、更安全地探索。

## 目标用户

MVP 面向个人开发者，尤其是经常需要理解真实代码库的初中级程序员。

典型用户包括：

- 正在阅读新开源项目的学生。
- 刚加入现有公司项目的初级工程师。
- 需要阅读后端代码的前端开发者。
- 需要阅读陌生前端代码的后端开发者。
- 使用国内或本地 LLM 服务，而不只依赖海外托管模型的开发者。

## MVP 范围

第一版以从项目目录启动的 TUI 会话为核心：

```bash
gps-code
```

首次运行时，GPS Code 引导用户完成模型配置：

- `baseURL`
- `apiKey`
- `model`
- 可选 preset，例如 DeepSeek、Qwen、Kimi、Ollama、GLM 或豆包

配置完成后，用户可以在持续的终端界面中用自然中文提问：

```text
这个项目怎么启动？
登录逻辑在哪？
帮我解释 src/auth 这一块。
这个接口的数据流是怎样的？
这个 Java 类为什么要这样分层？
这个 CMake 项目应该怎么构建？
```

MVP 必须支持：

- 自动识别项目类型。
- 生成轻量级 repo map。
- 发现关键文件。
- 检查 manifest 和构建文件。
- 按需读取文件。
- 在可用时通过 `rg` 进行文本和符号搜索。
- 用中文回答，并引用具体文件。
- 提出命令建议，但执行前必须经过用户确认。
- 为后续 diff 和 patch 工作流保留基础能力，但不把自动修改代码作为 MVP 主流程。

## 语言优先级

MVP 应该把有限开发精力优先投入到国内开发者常用的语言生态。

### P0 语言

JavaScript 和 TypeScript：

- 识别 `package.json`、lockfile、`tsconfig.json`、Vite、Next.js、Vue、React 和常见 Node 项目结构。
- 解释 npm、pnpm、yarn scripts。
- 识别前端入口、路由结构、API 请求代码、组件和构建命令。

Python：

- 识别 `pyproject.toml`、`requirements.txt`、`setup.py`、`Pipfile`、`poetry.lock` 和 `uv.lock`。
- 解释包结构、虚拟环境要求、启动命令和测试命令。
- 识别常见 FastAPI、Flask 和 Django 入口模式。

Java：

- 识别 `pom.xml`、`build.gradle`、`settings.gradle`、`src/main/java` 和 `src/test/java`。
- 解释 Maven 和 Gradle 命令。
- 识别 Spring Boot 启动类，以及常见的 controller、service、repository、mapper、entity 分层。

C 和 C++：

- 识别 `CMakeLists.txt`、`Makefile`、`compile_commands.json`、Visual Studio solution 文件和项目文件。
- 解释构建系统、target、include path、源文件和头文件关系，以及 `main` 这类可能的入口点。

### P1 语言

Go、Rust、PHP、C#、Kotlin 以及框架级增强，可以在 P0 语言能真正服务真实项目之后再补充。

## 产品人格

GPS Code 应该像一位资深软件工程师和代码导师。

它应该：

- 先给结论，再解释依据。
- 使用具体文件路径、函数名、类名、脚本和配置项。
- 不只解释代码做了什么，也解释代码为什么可能这样设计。
- 教会用户相关语法、架构、框架约定和工程实践。
- 针对初中级开发者调整讲解深度。
- 在证据不足时明确指出不确定性。
- 在不确定时继续搜索或读取文件，而不是假装知道。
- 主动建议安全的下一步。
- 执行命令前先请求用户确认。

推荐回答结构：

```text
结论：先用 1-3 句话回答核心问题。
依据：列出读取过的关键文件和判断依据。
讲解：按层次解释架构、模块、代码或语法。
注意：指出可能的风险、环境要求或容易误解的地方。
下一步：给一个可执行建议，必要时请求确认运行命令。
```

## 交互模型

GPS Code 使用 TUI 作为主界面。第一版应该像一个专注的终端工作区，而不是 Web 应用。

核心 UI 区域包括：

- 会话历史。
- 用户输入框。
- 工具调用状态。
- 文件引用。
- 命令确认提示。
- 错误和警告展示。

产品应该让 agent 的活动保持可见。当 GPS Code 读取文件、搜索文本或准备命令时，用户应该能看到足够上下文，从而信任它正在做什么。

## 安全模型

MVP 使用半自动安全模型。

允许自动执行：

- 列出文件。
- 读取文件。
- 搜索代码。
- 检查 manifest 和配置文件。
- 构建本地 repo map。

需要用户确认：

- 执行 shell 命令。
- 执行包管理器命令。
- 执行构建、测试或开发服务器命令。
- 应用 patch 或写入文件。
- git 操作，例如 commit、push、reset、merge 或 rebase。

默认拦截或需要强确认：

- 破坏性文件系统命令。
- 会删除大量文件的命令。
- force push。
- 数据库迁移。
- 会修改全局系统状态的命令。
- 涉及密钥的命令，除非用户明确确认。

MVP 应该优先解释和建议，而不是执行不可逆操作。

## 架构

GPS Code 建议使用 TypeScript 和 Node.js 实现，以获得更快的迭代速度和更成熟的生态支持。

推荐技术包：

- `pnpm` 作为包管理器。
- `commander` 或 `cac` 作为 CLI 命令框架。
- `ink` 实现 TUI。
- `zod` 做配置和工具 schema 校验。
- `execa` 执行命令。
- `fast-glob` 扫描文件。
- 本机可用时使用 `rg` 搜索。
- `vitest` 编写测试。
- `tsx` 用于开发运行。
- `tsup` 用于打包。

### 组件

TUI Shell：

- 负责终端界面。
- 展示聊天历史、工具调用、命令确认和文件引用。
- 将用户输入发送给 agent core。

Agent Core：

- 负责对话循环。
- 判断何时直接回答、何时使用工具。
- 协调模型调用、工作区证据和最终回答。
- 保持 agent 的证据驱动风格，并对齐资深工程师人格。

Model Client：

- 实现 OpenAI-compatible API 接入。
- 支持 `baseURL`、`apiKey`、`model`、`temperature` 和 `maxTokens`。
- 提供稳定的内部接口，方便后续加入 provider-specific 行为。

Workspace Indexer：

- 扫描当前项目。
- 识别语言、框架、包管理器、构建工具、脚本、测试命令、入口文件和关键目录。
- 为 agent 生成轻量 repo map。

Tool Runtime：

- 提供结构化工具，例如 `list_files`、`read_file`、`search_text`、`inspect_manifest`、`suggest_command`、`run_command_with_confirm` 和 `show_diff`。
- 校验工具输入和输出。
- 避免让模型生成的普通文本直接执行系统操作。

Permission Layer：

- 执行安全规则。
- 在命令或文件修改前请求确认。
- 默认阻止高风险操作。

Session Store：

- 保存模型配置、会话历史、工具日志和 repo map 缓存。
- 第一版可以先使用用户级配置目录中的 JSON 文件，并可选使用项目本地缓存。

## 数据流

```text
用户输入
 -> TUI Shell
 -> Agent Core
 -> Model Client
 -> Tool Runtime 或 Workspace Indexer
 -> Agent Core 汇总证据
 -> 资深工程师风格中文回答
 -> TUI 展示回答、文件引用和建议下一步
```

核心规则是：重要回答必须基于项目证据。如果 GPS Code 说某段逻辑在哪里，或者项目如何启动，它应该引用支持结论的文件或脚本。

## 建议目录结构

```text
gps-code/
  package.json
  tsconfig.json
  src/
    cli/
      index.ts
      commands.ts
    tui/
      App.tsx
      components/
    agent/
      agent.ts
      prompts.ts
      intent.ts
    model/
      client.ts
      config.ts
      providers.ts
    workspace/
      indexer.ts
      project-type.ts
      repo-map.ts
      languages/
        javascript.ts
        python.ts
        java.ts
        cpp.ts
    tools/
      registry.ts
      read-file.ts
      list-files.ts
      search-text.ts
      run-command.ts
      diff.ts
    permissions/
      policy.ts
      confirm.ts
    session/
      store.ts
      transcript.ts
    shared/
      types.ts
      errors.ts
  tests/
    agent/
    workspace/
    tools/
  docs/
```

## 里程碑

### M1：可配置的 TUI 对话

用户可以运行 `gps-code`，配置 OpenAI-compatible 模型，并在 TUI 会话中聊天。会话历史保存在本地。

### M2：项目理解

GPS Code 扫描当前工作区，识别项目类型，并构建轻量 repo map。它能够回答启动、构建、测试、入口点和高层架构问题，并给出文件引用。

### M3：按需代码搜索

GPS Code 可以通过工具列出文件、读取文件和搜索代码。它能在 JS/TS、Python、Java 和 C/C++ 项目中定位功能、函数、类、路由、controller、service 或构建 target。

### M4：半自动辅助

GPS Code 可以建议命令、请求确认、执行已确认命令、总结输出，并准备简单 diff。代码修改作为次要能力存在，而解释和导航仍然是 MVP 的主要体验。

## MVP 验收标准

当 GPS Code 能在有代表性的 JS/TS、Python、Java 和 C/C++ 项目中使用，并可靠回答以下问题时，MVP 可以准备初始发布：

- 这是什么类型的项目？
- 我该如何安装依赖、构建、启动或测试？
- 主入口在哪里？
- 主要目录分别负责什么？
- 某个指定功能、函数、路由、类或模块在哪里实现？
- 某个选中文件、函数、类或模块做了什么？
- 下一步我应该验证什么？

它还应该做到：

- 在回答中展示具体文件引用。
- 执行命令前先询问用户。
- 清楚解释模型、网络、文件和命令失败。
- 避免在证据不足时表现得过度确定。

## V1 明确不做的事

第一版不需要：

- 完整 IDE。
- Web 应用。
- 云同步。
- 多人协作。
- 自动创建 PR。
- 插件市场。
- 向量数据库依赖。
- 强自动代码修改。
- 对每一种编程语言都做深度支持。
- 适配每个 OpenAI-compatible 服务的 provider-specific 特殊 API 行为。
- 自动执行 shell、git、构建或包管理器命令。

## 关键风险

范围膨胀：

- Code agent 很自然会引出很多功能。V1 应该持续聚焦在代码库理解、导航和安全辅助上。

模型差异：

- OpenAI-compatible provider 在行为和参数支持上存在差异。第一版应该保持模型接口简单，并逐步增加 preset。

信任：

- 用户不会信任一个靠猜的 code agent。GPS Code 必须展示证据、在风险操作前请求确认，并解释不确定性。

语言深度：

- JS/TS、Python、Java 和 C/C++ 各自有不同项目约定。MVP 应该先实现实用的检测和解释启发式，再考虑深度语义分析。

## 待定设计决策

这些可以在实施计划阶段决定：

- 使用 `commander` 还是 `cac`。
- 模型调用使用官方 OpenAI SDK，还是一个小型 fetch-based client。
- 具体用户配置路径。
- 具体 TUI 布局。
- V1 是否使用项目本地 `.gps-code/` 缓存，还是先只使用用户级缓存。

