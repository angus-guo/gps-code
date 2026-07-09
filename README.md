# GPS Code

GPS Code 是一款中文优先的 TUI code agent，面向个人开发者，尤其适合初中级程序员理解陌生代码库。

第一版重点：

- 在项目目录中运行 `gps-code`
- 支持 OpenAI-compatible 模型配置
- 支持 DeepSeek、Qwen、Kimi、Ollama 等兼容服务
- 自动生成轻量 repo map
- 优先适配 JS/TS、Python、Java、C/C++
- 用资深软件工程师风格解释项目结构、启动方式、入口文件和关键模块

## 开发

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

查看内置 preset：

```bash
gps-code config:presets
```

## 启动

```bash
gps-code
```

## 当前状态

GPS Code 目前处于早期 MVP 阶段。M1-M2 的目标是完成可配置 TUI 对话和项目理解能力；代码搜索、命令确认执行、diff 和 patch 能力会在后续里程碑加入。
