# GPS Code Design

Date: 2026-06-30

## Summary

GPS Code is a Chinese-first, open-source TUI code agent for individual developers. It runs inside a local project directory and helps users understand, navigate, and reason about unfamiliar codebases with the feel of a senior software engineer.

The first version prioritizes codebase explanation and navigation over full automation. It should help junior and mid-level developers answer questions such as:

- What is this project?
- How do I start, build, or test it?
- Where is the entry point?
- Where is a specific feature implemented?
- What does this function, class, file, or module do?
- Why might the code be designed this way?
- What should I verify next?

GPS Code should feel professional, patient, evidence-driven, and practical. It should not merely translate code into Chinese. It should explain architecture, implementation intent, language syntax, common engineering conventions, and possible risks in a way that helps the user become a better developer.

## Product Positioning

GPS Code is a local terminal product for personal developers who want a Chinese-friendly alternative to tools such as Claude Code, with better support for domestic and open model ecosystems.

The product focuses on:

- Chinese interaction and explanation quality.
- OpenAI-compatible model access.
- Domestic model friendliness, including DeepSeek, Qwen, Kimi, GLM, Doubao, Ollama, and other compatible services.
- Transparent tool use and file evidence.
- Safe semi-automatic behavior.
- Strong guidance for junior and mid-level programmers.

The first release should avoid trying to fully replicate every Claude Code feature. Its core value is to make unfamiliar projects easier to understand and safer to explore.

## Target Users

The MVP targets individual developers, especially junior and mid-level programmers who often need help understanding real codebases.

Typical users include:

- A student opening a new open-source project.
- A junior engineer joining an existing company project.
- A frontend developer reading backend code.
- A backend developer reading unfamiliar frontend code.
- A developer using domestic or local LLM services instead of only international hosted models.

## MVP Scope

The first version centers on a TUI session launched from a project directory:

```bash
gps-code
```

On first run, GPS Code guides the user through model configuration:

- `baseURL`
- `apiKey`
- `model`
- optional preset, such as DeepSeek, Qwen, Kimi, Ollama, GLM, or Doubao

After configuration, the user can ask natural Chinese questions in a persistent terminal interface:

```text
这个项目怎么启动？
登录逻辑在哪？
帮我解释 src/auth 这一块。
这个接口的数据流是怎样的？
这个 Java 类为什么要这样分层？
这个 CMake 项目应该怎么构建？
```

The MVP must support:

- Automatic project type detection.
- Lightweight repo map generation.
- Key file discovery.
- Manifest and build file inspection.
- On-demand file reading.
- Text and symbol search through `rg` when available.
- Chinese answers with concrete file references.
- Command suggestions with user confirmation before execution.
- A foundation for future diff and patch workflows, without making automatic code modification the main MVP flow.

## Language Priorities

The MVP should focus limited development effort on languages commonly used by domestic developers.

### P0 Languages

JavaScript and TypeScript:

- Detect `package.json`, lockfiles, `tsconfig.json`, Vite, Next.js, Vue, React, and common Node project layouts.
- Explain npm, pnpm, and yarn scripts.
- Identify frontend entry points, route structure, API request code, components, and build commands.

Python:

- Detect `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `poetry.lock`, and `uv.lock`.
- Explain package structure, virtual environment expectations, startup commands, and test commands.
- Recognize common FastAPI, Flask, and Django entry patterns.

Java:

- Detect `pom.xml`, `build.gradle`, `settings.gradle`, `src/main/java`, and `src/test/java`.
- Explain Maven and Gradle commands.
- Recognize Spring Boot entry classes and common controller, service, repository, mapper, and entity layers.

C and C++:

- Detect `CMakeLists.txt`, `Makefile`, `compile_commands.json`, Visual Studio solution files, and project files.
- Explain build systems, targets, include paths, source/header relationships, and likely entry points such as `main`.

### P1 Languages

Go, Rust, PHP, C#, Kotlin, and framework-specific enhancements can follow after the P0 languages are useful in real projects.

## Product Personality

GPS Code should behave like a senior software engineer and code mentor.

It should:

- Give the conclusion first, then explain the evidence.
- Use specific file paths, function names, class names, scripts, and configuration keys.
- Explain not only what the code does, but why it may have been designed that way.
- Teach relevant syntax, architecture, framework conventions, and engineering practices.
- Adjust explanation depth for junior and mid-level developers.
- Point out uncertainty when evidence is insufficient.
- Search or read more files instead of pretending to know.
- Suggest safe next steps.
- Ask for confirmation before executing commands.

Preferred answer shape:

```text
结论：先用 1-3 句话回答核心问题。
依据：列出读取过的关键文件和判断依据。
讲解：按层次解释架构、模块、代码或语法。
注意：指出可能的风险、环境要求或容易误解的地方。
下一步：给一个可执行建议，必要时请求确认运行命令。
```

## Interaction Model

GPS Code uses a TUI as the main interface. The first version should feel like a focused terminal workspace, not a web app.

Core UI areas:

- Conversation history.
- User input box.
- Tool call status.
- File references.
- Command confirmation prompts.
- Error and warning display.

The product should make agent activity visible. When GPS Code reads files, searches text, or prepares a command, the user should see enough context to trust what is happening.

## Safety Model

The MVP uses a semi-automatic safety model.

Allowed automatically:

- Listing files.
- Reading files.
- Searching code.
- Inspecting manifests and configuration.
- Building a local repo map.

Requires confirmation:

- Running shell commands.
- Running package manager commands.
- Running build, test, or dev server commands.
- Applying patches or writing files.
- Git operations such as commit, push, reset, merge, or rebase.

Blocked or requires strong confirmation:

- Destructive filesystem commands.
- Commands that delete many files.
- Force push.
- Database migrations.
- Commands that modify global system state.
- Commands involving secrets unless the user explicitly confirms.

The MVP should prefer explaining and suggesting over taking irreversible action.

## Architecture

GPS Code should be implemented in TypeScript on Node.js for fast iteration and strong ecosystem support.

Recommended packages:

- `pnpm` for package management.
- `commander` or `cac` for CLI commands.
- `ink` for the TUI.
- `zod` for config and tool schema validation.
- `execa` for command execution.
- `fast-glob` for file scanning.
- local `rg` for search when available.
- `vitest` for tests.
- `tsx` for development.
- `tsup` for packaging.

### Components

TUI Shell:

- Owns the terminal interface.
- Displays chat history, tool calls, command confirmations, and file references.
- Sends user input into the agent core.

Agent Core:

- Owns the conversation loop.
- Decides when to answer directly and when to use tools.
- Coordinates model calls, workspace evidence, and final responses.
- Keeps the agent evidence-driven and aligned with the senior engineer persona.

Model Client:

- Implements OpenAI-compatible API access.
- Supports `baseURL`, `apiKey`, `model`, `temperature`, and `maxTokens`.
- Provides a stable internal interface so provider-specific behavior can be added later.

Workspace Indexer:

- Scans the current project.
- Detects language, framework, package manager, build tool, scripts, test commands, entry files, and key directories.
- Produces a lightweight repo map for the agent.

Tool Runtime:

- Provides structured tools such as `list_files`, `read_file`, `search_text`, `inspect_manifest`, `suggest_command`, `run_command_with_confirm`, and `show_diff`.
- Validates tool inputs and outputs.
- Avoids letting model text directly execute system operations.

Permission Layer:

- Enforces safety rules.
- Requires confirmation before commands or file modifications.
- Blocks high-risk operations by default.

Session Store:

- Saves model configuration, session history, tool logs, and repo map cache.
- Can start with JSON files in a user-level config directory and optional project-local cache.

## Data Flow

```text
User input
 -> TUI Shell
 -> Agent Core
 -> Model Client
 -> Tool Runtime or Workspace Indexer
 -> Agent Core summarizes evidence
 -> Senior-engineer-style Chinese response
 -> TUI displays answer, file references, and suggested next steps
```

The central rule is that important answers should be grounded in project evidence. If GPS Code says where logic lives or how a project starts, it should cite the files or scripts that support the conclusion.

## Suggested Directory Structure

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

## Milestones

### M1: Configurable TUI Chat

Users can run `gps-code`, configure an OpenAI-compatible model, and chat inside a TUI session. Session history is saved locally.

### M2: Project Understanding

GPS Code scans the current workspace, detects the project type, and builds a lightweight repo map. It can answer startup, build, test, entry point, and high-level architecture questions with file references.

### M3: On-Demand Code Search

GPS Code can list files, read files, and search code through tools. It can locate features, functions, classes, routes, controllers, services, or build targets in JS/TS, Python, Java, and C/C++ projects.

### M4: Semi-Automatic Assistance

GPS Code can suggest commands, ask for confirmation, run confirmed commands, summarize outputs, and prepare simple diffs. Code modification exists as a secondary capability, while explanation and navigation remain the primary MVP experience.

## MVP Acceptance Criteria

The MVP is ready for an initial release when it can be used on representative JS/TS, Python, Java, and C/C++ projects and reliably answer:

- What kind of project is this?
- How do I install dependencies, build, start, or test it?
- Where is the main entry point?
- What are the main directories responsible for?
- Where is a named feature, function, route, class, or module implemented?
- What does a selected file, function, class, or module do?
- What should I verify next?

It should also:

- Show concrete file references in answers.
- Ask before running commands.
- Explain model, network, file, and command failures clearly.
- Avoid claiming certainty without evidence.

## Explicit Non-Goals For V1

The first version does not need:

- A full IDE.
- A web app.
- Cloud synchronization.
- Multi-user collaboration.
- Automatic PR creation.
- A plugin marketplace.
- Vector database dependency.
- Strong automatic code modification.
- Deep support for every programming language.
- Provider-specific special API behavior for every OpenAI-compatible service.
- Automatic execution of shell, git, build, or package manager commands.

## Key Risks

Scope creep:

- Code agents naturally invite many features. V1 should stay focused on codebase understanding, navigation, and safe assistance.

Model variance:

- OpenAI-compatible providers differ in behavior and parameter support. The first version should keep the model interface simple and add presets gradually.

Trust:

- Users will not trust a code agent that guesses. GPS Code must show evidence, ask before risky actions, and explain uncertainty.

Language depth:

- JS/TS, Python, Java, and C/C++ each have different project conventions. The MVP should implement practical detection and explanation heuristics before attempting deep semantic analysis.

## Open Design Decisions

These can be decided during implementation planning:

- Whether to use `commander` or `cac`.
- Whether model calls should use the official OpenAI SDK or a small fetch-based client.
- Exact user config path.
- Exact TUI layout.
- Whether project-local cache should live in `.gps-code/` from V1 or start as user-level cache only.

