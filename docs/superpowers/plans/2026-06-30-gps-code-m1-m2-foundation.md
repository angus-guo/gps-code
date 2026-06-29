# GPS Code M1-M2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable GPS Code foundation: TypeScript project scaffold, CLI entry, local config, OpenAI-compatible model client, TUI chat shell, and lightweight repo map for JS/TS, Python, Java, and C/C++ projects.

**Architecture:** The first implementation keeps the system small and testable. CLI code launches either config commands or the Ink TUI, the TUI calls a simple agent service, the agent combines user messages with repo-map evidence, and the model client talks to OpenAI-compatible chat completions. Workspace detection is deterministic and unit-tested before being used by the agent.

**Tech Stack:** TypeScript, Node.js 20+, pnpm, commander, ink, react, zod, execa, fast-glob, vitest, tsx, tsup.

---

## Scope

This plan implements M1 and M2 from the design spec.

In scope:

- Project scaffold and npm package metadata.
- `gps-code` CLI executable.
- Local configuration read/write and provider presets.
- OpenAI-compatible chat completions client.
- Minimal senior-engineer system prompt.
- Ink TUI chat loop.
- Workspace repo-map generation for JS/TS, Python, Java, and C/C++.
- Tests for config, model request construction, and repo-map detection.

Out of scope:

- M3 tool-calling code search loop.
- M4 command execution confirmation.
- File modification, diff application, git automation, plugin systems, cloud sync, or vector databases.

## File Structure

- Create `package.json`: package metadata, binary entry, scripts, dependencies.
- Create `tsconfig.json`: strict TypeScript configuration.
- Create `tsup.config.ts`: build config for CLI output.
- Create `vitest.config.ts`: test config.
- Create `.gitignore`: Node, build, coverage, local env ignores.
- Create `src/cli/index.ts`: executable entrypoint.
- Create `src/cli/commands.ts`: commander program setup.
- Create `src/config/schema.ts`: zod schemas and provider preset definitions.
- Create `src/config/store.ts`: JSON config read/write helpers.
- Create `src/model/types.ts`: shared model message and config types.
- Create `src/model/openai-compatible.ts`: fetch-based OpenAI-compatible client.
- Create `src/agent/prompts.ts`: senior engineer system prompt.
- Create `src/agent/agent.ts`: minimal answer orchestration.
- Create `src/workspace/types.ts`: repo-map types.
- Create `src/workspace/languages/javascript.ts`: JS/TS detector.
- Create `src/workspace/languages/python.ts`: Python detector.
- Create `src/workspace/languages/java.ts`: Java detector.
- Create `src/workspace/languages/cpp.ts`: C/C++ detector.
- Create `src/workspace/indexer.ts`: project scanner and repo-map builder.
- Create `src/tui/App.tsx`: Ink app.
- Create `src/tui/components/ChatView.tsx`: message list rendering.
- Create `src/tui/components/InputBox.tsx`: input handling.
- Create `src/shared/errors.ts`: user-facing error formatting.
- Create `tests/config/store.test.ts`: config behavior tests.
- Create `tests/model/openai-compatible.test.ts`: model request tests.
- Create `tests/workspace/indexer.test.ts`: repo-map tests.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create package metadata**

Create `package.json`:

```json
{
  "name": "gps-code",
  "version": "0.1.0",
  "description": "Chinese-first TUI code agent for understanding local codebases.",
  "type": "module",
  "bin": {
    "gps-code": "./dist/cli/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "execa": "^9.6.0",
    "fast-glob": "^3.3.3",
    "ink": "^5.2.1",
    "react": "^18.3.1",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@types/node": "^22.15.34",
    "@types/react": "^18.3.23",
    "tsup": "^8.5.0",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "react"]
  },
  "include": ["src", "tests", "tsup.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create build config**

Create `tsup.config.ts`:

```ts
import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node'
  }
});
```

- [ ] **Step 4: Create test config**

Create `vitest.config.ts`:

```ts
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true
  }
});
```

- [ ] **Step 5: Create ignore rules**

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
.DS_Store
.gps-code/
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` is created and dependencies install successfully.

- [ ] **Step 7: Verify empty scaffold**

Run:

```bash
pnpm typecheck
```

Expected: TypeScript reports no source files or no type errors after source files are added in later tasks. If it fails because `src` does not exist yet, create `src/.gitkeep` temporarily or wait until Task 2 creates source files.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsup.config.ts vitest.config.ts .gitignore
git commit -m "chore: scaffold TypeScript package"
```

---

### Task 2: Config Schema And Store

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/store.ts`
- Create: `tests/config/store.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `tests/config/store.test.ts`:

```ts
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadConfig, saveConfig} from '../../src/config/store.js';

let tempDirs: string[] = [];

async function makeTempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('config store', () => {
  it('returns null when config file is missing', async () => {
    const homeDir = await makeTempHome();
    await expect(loadConfig({homeDir})).resolves.toBeNull();
  });

  it('saves and loads model config', async () => {
    const homeDir = await makeTempHome();
    await saveConfig(
      {
        baseURL: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        temperature: 0.2,
        maxTokens: 4096
      },
      {homeDir}
    );

    await expect(loadConfig({homeDir})).resolves.toEqual({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 4096
    });

    const raw = await readFile(join(homeDir, '.gps-code', 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({model: 'deepseek-chat'});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test tests/config/store.test.ts
```

Expected: FAIL because `src/config/store.ts` does not exist.

- [ ] **Step 3: Implement config schema**

Create `src/config/schema.ts`:

```ts
import {z} from 'zod';

export const modelConfigSchema = z.object({
  baseURL: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(4096)
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export type ProviderPreset = {
  name: string;
  label: string;
  baseURL: string;
  defaultModel: string;
};

export const providerPresets: ProviderPreset[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  {
    name: 'qwen',
    label: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus'
  },
  {
    name: 'kimi',
    label: 'Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k'
  },
  {
    name: 'ollama',
    label: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder'
  }
];
```

- [ ] **Step 4: Implement config store**

Create `src/config/store.ts`:

```ts
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {modelConfigSchema, type ModelConfig} from './schema.js';

export type ConfigStoreOptions = {
  homeDir?: string;
};

function getHomeDir(options: ConfigStoreOptions = {}) {
  return options.homeDir ?? process.env.HOME ?? process.cwd();
}

export function getConfigPath(options: ConfigStoreOptions = {}) {
  return join(getHomeDir(options), '.gps-code', 'config.json');
}

export async function loadConfig(options: ConfigStoreOptions = {}): Promise<ModelConfig | null> {
  try {
    const raw = await readFile(getConfigPath(options), 'utf8');
    return modelConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveConfig(config: ModelConfig, options: ConfigStoreOptions = {}) {
  const parsed = modelConfigSchema.parse(config);
  const configPath = getConfigPath(options);
  await mkdir(join(getHomeDir(options), '.gps-code'), {recursive: true});
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}
```

- [ ] **Step 5: Run config tests**

Run:

```bash
pnpm test tests/config/store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/config/store.ts tests/config/store.test.ts
git commit -m "feat: add model config store"
```

---

### Task 3: Workspace Repo Map

**Files:**
- Create: `src/workspace/types.ts`
- Create: `src/workspace/languages/javascript.ts`
- Create: `src/workspace/languages/python.ts`
- Create: `src/workspace/languages/java.ts`
- Create: `src/workspace/languages/cpp.ts`
- Create: `src/workspace/indexer.ts`
- Create: `tests/workspace/indexer.test.ts`

- [ ] **Step 1: Write failing repo-map tests**

Create `tests/workspace/indexer.test.ts`:

```ts
import {mkdir, writeFile, rm, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {buildRepoMap} from '../../src/workspace/indexer.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-workspace-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('buildRepoMap', () => {
  it('detects a JS/TS project from package.json', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'package.json'), JSON.stringify({scripts: {dev: 'vite', test: 'vitest'}}));
    await writeFile(join(root, 'tsconfig.json'), '{}');

    const map = await buildRepoMap(root);

    expect(map.root).toBe(root);
    expect(map.languages).toContain('javascript-typescript');
    expect(map.packageManagers).toContain('npm');
    expect(map.scripts).toContainEqual({name: 'dev', command: 'vite', source: 'package.json'});
    expect(map.keyFiles).toContain('package.json');
  });

  it('detects Python, Java, and C/C++ signals', async () => {
    const root = await makeProject();
    await mkdir(join(root, 'src', 'main', 'java'), {recursive: true});
    await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
    await writeFile(join(root, 'pom.xml'), '<project></project>');
    await writeFile(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)');

    const map = await buildRepoMap(root);

    expect(map.languages).toEqual(
      expect.arrayContaining(['python', 'java', 'c-cpp'])
    );
    expect(map.buildTools).toEqual(expect.arrayContaining(['maven', 'cmake']));
    expect(map.keyFiles).toEqual(expect.arrayContaining(['pyproject.toml', 'pom.xml', 'CMakeLists.txt']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test tests/workspace/indexer.test.ts
```

Expected: FAIL because workspace files do not exist.

- [ ] **Step 3: Define repo-map types**

Create `src/workspace/types.ts`:

```ts
export type SupportedLanguage = 'javascript-typescript' | 'python' | 'java' | 'c-cpp';

export type RepoScript = {
  name: string;
  command: string;
  source: string;
};

export type RepoMap = {
  root: string;
  languages: SupportedLanguage[];
  frameworks: string[];
  packageManagers: string[];
  buildTools: string[];
  scripts: RepoScript[];
  keyFiles: string[];
  keyDirectories: string[];
};

export type LanguageDetectorResult = Partial<Omit<RepoMap, 'root'>>;
```

- [ ] **Step 4: Implement JS/TS detector**

Create `src/workspace/languages/javascript.ts`:

```ts
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {LanguageDetectorResult, RepoScript} from '../types.js';

export async function detectJavaScript(root: string, files: Set<string>): Promise<LanguageDetectorResult> {
  if (!files.has('package.json') && !files.has('tsconfig.json')) {
    return {};
  }

  const keyFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs']
    .filter((file) => files.has(file));
  const packageManagers = [
    files.has('pnpm-lock.yaml') ? 'pnpm' : null,
    files.has('yarn.lock') ? 'yarn' : null,
    files.has('package-lock.json') ? 'npm' : null
  ].filter((value): value is string => Boolean(value));
  const scripts: RepoScript[] = [];
  const frameworks: string[] = [];

  if (files.has('package.json')) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      scripts.push({name, command, source: 'package.json'});
    }
    const deps = {...pkg.dependencies, ...pkg.devDependencies};
    if ('vite' in deps) frameworks.push('vite');
    if ('next' in deps) frameworks.push('nextjs');
    if ('vue' in deps) frameworks.push('vue');
    if ('react' in deps) frameworks.push('react');
  }

  return {
    languages: ['javascript-typescript'],
    packageManagers: packageManagers.length > 0 ? packageManagers : ['npm'],
    frameworks,
    scripts,
    keyFiles
  };
}
```

- [ ] **Step 5: Implement Python detector**

Create `src/workspace/languages/python.ts`:

```ts
import type {LanguageDetectorResult} from '../types.js';

export function detectPython(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'poetry.lock', 'uv.lock']
    .filter((file) => files.has(file));

  if (keyFiles.length === 0) {
    return {};
  }

  const packageManagers = [
    files.has('poetry.lock') ? 'poetry' : null,
    files.has('uv.lock') ? 'uv' : null,
    files.has('requirements.txt') ? 'pip' : null
  ].filter((value): value is string => Boolean(value));

  return {
    languages: ['python'],
    packageManagers,
    keyFiles
  };
}
```

- [ ] **Step 6: Implement Java detector**

Create `src/workspace/languages/java.ts`:

```ts
import type {LanguageDetectorResult} from '../types.js';

export function detectJava(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
    .filter((file) => files.has(file));
  const hasJavaLayout = [...files].some((file) => file.startsWith('src/main/java/'));

  if (keyFiles.length === 0 && !hasJavaLayout) {
    return {};
  }

  return {
    languages: ['java'],
    buildTools: [
      files.has('pom.xml') ? 'maven' : null,
      files.has('build.gradle') || files.has('build.gradle.kts') ? 'gradle' : null
    ].filter((value): value is string => Boolean(value)),
    keyFiles,
    keyDirectories: hasJavaLayout ? ['src/main/java'] : []
  };
}
```

- [ ] **Step 7: Implement C/C++ detector**

Create `src/workspace/languages/cpp.ts`:

```ts
import type {LanguageDetectorResult} from '../types.js';

export function detectCpp(files: Set<string>): LanguageDetectorResult {
  const keyFiles = ['CMakeLists.txt', 'Makefile', 'compile_commands.json']
    .filter((file) => files.has(file));
  const hasCppSource = [...files].some((file) => /\.(c|cc|cpp|cxx|h|hpp)$/.test(file));

  if (keyFiles.length === 0 && !hasCppSource) {
    return {};
  }

  return {
    languages: ['c-cpp'],
    buildTools: [
      files.has('CMakeLists.txt') ? 'cmake' : null,
      files.has('Makefile') ? 'make' : null
    ].filter((value): value is string => Boolean(value)),
    keyFiles
  };
}
```

- [ ] **Step 8: Implement indexer**

Create `src/workspace/indexer.ts`:

```ts
import fg from 'fast-glob';
import {detectJavaScript} from './languages/javascript.js';
import {detectPython} from './languages/python.js';
import {detectJava} from './languages/java.js';
import {detectCpp} from './languages/cpp.js';
import type {LanguageDetectorResult, RepoMap} from './types.js';

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function mergeResults(root: string, results: LanguageDetectorResult[]): RepoMap {
  return {
    root,
    languages: unique(results.flatMap((result) => result.languages ?? [])),
    frameworks: unique(results.flatMap((result) => result.frameworks ?? [])),
    packageManagers: unique(results.flatMap((result) => result.packageManagers ?? [])),
    buildTools: unique(results.flatMap((result) => result.buildTools ?? [])),
    scripts: results.flatMap((result) => result.scripts ?? []),
    keyFiles: unique(results.flatMap((result) => result.keyFiles ?? [])),
    keyDirectories: unique(results.flatMap((result) => result.keyDirectories ?? []))
  };
}

export async function buildRepoMap(root = process.cwd()): Promise<RepoMap> {
  const entries = await fg(['**/*'], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**']
  });
  const files = new Set(entries);
  const results = await Promise.all([
    detectJavaScript(root, files),
    Promise.resolve(detectPython(files)),
    Promise.resolve(detectJava(files)),
    Promise.resolve(detectCpp(files))
  ]);

  return mergeResults(root, results);
}
```

- [ ] **Step 9: Run workspace tests**

Run:

```bash
pnpm test tests/workspace/indexer.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/workspace tests/workspace
git commit -m "feat: add workspace repo map"
```

---

### Task 4: OpenAI-Compatible Model Client

**Files:**
- Create: `src/model/types.ts`
- Create: `src/model/openai-compatible.ts`
- Create: `tests/model/openai-compatible.test.ts`

- [ ] **Step 1: Write failing model client tests**

Create `tests/model/openai-compatible.test.ts`:

```ts
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createOpenAICompatibleClient} from '../../src/model/openai-compatible.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAI-compatible client', () => {
  it('posts chat completions request and returns assistant text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{message: {role: 'assistant', content: '你好，我是 GPS Code。'}}]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAICompatibleClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 1024
    });

    await expect(client.chat([{role: 'user', content: '你好'}])).resolves.toBe('你好，我是 GPS Code。');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret',
          'content-type': 'application/json'
        })
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test tests/model/openai-compatible.test.ts
```

Expected: FAIL because model client files do not exist.

- [ ] **Step 3: Define model types**

Create `src/model/types.ts`:

```ts
import type {ModelConfig} from '../config/schema.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ModelClient = {
  chat(messages: ChatMessage[]): Promise<string>;
};

export type ModelClientConfig = ModelConfig;
```

- [ ] **Step 4: Implement fetch-based client**

Create `src/model/openai-compatible.ts`:

```ts
import type {ChatMessage, ModelClient, ModelClientConfig} from './types.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

function joinURL(baseURL: string, path: string) {
  return `${baseURL.replace(/\/+$/, '')}${path}`;
}

export function createOpenAICompatibleClient(config: ModelClientConfig): ModelClient {
  return {
    async chat(messages: ChatMessage[]) {
      const response = await fetch(joinURL(config.baseURL, '/chat/completions'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens
        })
      });

      const data = (await response.json()) as ChatCompletionResponse;

      if (!response.ok) {
        throw new Error(data.error?.message ?? `Model request failed with status ${response.status}`);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Model response did not include assistant content.');
      }

      return content;
    }
  };
}
```

- [ ] **Step 5: Run model tests**

Run:

```bash
pnpm test tests/model/openai-compatible.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model tests/model
git commit -m "feat: add OpenAI-compatible client"
```

---

### Task 5: Agent Core And Prompt

**Files:**
- Create: `src/agent/prompts.ts`
- Create: `src/agent/agent.ts`
- Create: `tests/agent/agent.test.ts`

- [ ] **Step 1: Write failing agent test**

Create `tests/agent/agent.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {createAgent} from '../../src/agent/agent.js';
import type {ModelClient} from '../../src/model/types.js';
import type {RepoMap} from '../../src/workspace/types.js';

describe('agent', () => {
  it('adds senior engineer prompt and repo-map evidence to model messages', async () => {
    const calls: unknown[] = [];
    const model: ModelClient = {
      async chat(messages) {
        calls.push(messages);
        return '结论：这是一个 TypeScript 项目。';
      }
    };
    const repoMap: RepoMap = {
      root: '/demo',
      languages: ['javascript-typescript'],
      frameworks: ['vite'],
      packageManagers: ['pnpm'],
      buildTools: [],
      scripts: [{name: 'dev', command: 'vite', source: 'package.json'}],
      keyFiles: ['package.json', 'tsconfig.json'],
      keyDirectories: []
    };

    const agent = createAgent({model, repoMap});
    const answer = await agent.ask('这个项目怎么启动？');

    expect(answer).toContain('TypeScript');
    expect(JSON.stringify(calls[0])).toContain('资深软件工程师');
    expect(JSON.stringify(calls[0])).toContain('package.json');
    expect(JSON.stringify(calls[0])).toContain('pnpm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test tests/agent/agent.test.ts
```

Expected: FAIL because agent files do not exist.

- [ ] **Step 3: Create senior engineer prompt**

Create `src/agent/prompts.ts`:

```ts
export const seniorEngineerSystemPrompt = `你是 GPS Code，一位中文优先的资深软件工程师和代码导师。

你的目标是帮助初中级开发者理解真实代码库。回答时必须：
1. 先给结论，再解释依据。
2. 引用具体文件、脚本、类名、函数名或配置项。
3. 解释代码做了什么，以及为什么可能这样设计。
4. 如果证据不足，明确说明不确定，并建议继续检查什么。
5. 不要假装已经读取没有提供给你的文件。
6. 对命令执行、文件修改、git 操作保持谨慎，优先建议并请求确认。

推荐结构：
结论：1-3 句话回答核心问题。
依据：列出证据。
讲解：分层解释架构、模块、代码或语法。
注意：指出风险、环境要求或容易误解的地方。
下一步：给出安全、可执行的建议。`;
```

- [ ] **Step 4: Implement agent core**

Create `src/agent/agent.ts`:

```ts
import {seniorEngineerSystemPrompt} from './prompts.js';
import type {ModelClient} from '../model/types.js';
import type {RepoMap} from '../workspace/types.js';

export type Agent = {
  ask(input: string): Promise<string>;
};

export type AgentOptions = {
  model: ModelClient;
  repoMap: RepoMap;
};

function formatRepoMap(repoMap: RepoMap) {
  return JSON.stringify(
    {
      root: repoMap.root,
      languages: repoMap.languages,
      frameworks: repoMap.frameworks,
      packageManagers: repoMap.packageManagers,
      buildTools: repoMap.buildTools,
      scripts: repoMap.scripts,
      keyFiles: repoMap.keyFiles,
      keyDirectories: repoMap.keyDirectories
    },
    null,
    2
  );
}

export function createAgent(options: AgentOptions): Agent {
  return {
    async ask(input: string) {
      return options.model.chat([
        {role: 'system', content: seniorEngineerSystemPrompt},
        {
          role: 'system',
          content: `当前项目 repo map 如下。只能基于这些证据回答；如果需要更多文件，说明你还需要检查什么。\n\n${formatRepoMap(options.repoMap)}`
        },
        {role: 'user', content: input}
      ]);
    }
  };
}
```

- [ ] **Step 5: Run agent tests**

Run:

```bash
pnpm test tests/agent/agent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent tests/agent
git commit -m "feat: add senior engineer agent core"
```

---

### Task 6: CLI Commands

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands.ts`
- Create: `src/shared/errors.ts`

- [ ] **Step 1: Implement error formatting**

Create `src/shared/errors.ts`:

```ts
export function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
```

- [ ] **Step 2: Implement commander commands**

Create `src/cli/commands.ts`:

```ts
import {Command} from 'commander';
import {render} from 'ink';
import React from 'react';
import {modelConfigSchema, providerPresets} from '../config/schema.js';
import {loadConfig, saveConfig} from '../config/store.js';
import {App} from '../tui/App.js';

export function createProgram() {
  const program = new Command();

  program
    .name('gps-code')
    .description('Chinese-first TUI code agent for understanding local codebases.')
    .version('0.1.0');

  program
    .command('config:set')
    .description('Save OpenAI-compatible model configuration.')
    .requiredOption('--base-url <url>', 'OpenAI-compatible base URL')
    .requiredOption('--api-key <key>', 'API key')
    .requiredOption('--model <model>', 'Model name')
    .option('--temperature <number>', 'Sampling temperature', '0.2')
    .option('--max-tokens <number>', 'Maximum output tokens', '4096')
    .action(async (options) => {
      const config = modelConfigSchema.parse({
        baseURL: options.baseUrl,
        apiKey: options.apiKey,
        model: options.model,
        temperature: Number(options.temperature),
        maxTokens: Number(options.maxTokens)
      });
      await saveConfig(config);
      console.log('GPS Code model config saved.');
    });

  program
    .command('config:presets')
    .description('List built-in provider presets.')
    .action(() => {
      for (const preset of providerPresets) {
        console.log(`${preset.name}\t${preset.label}\t${preset.baseURL}\t${preset.defaultModel}`);
      }
    });

  program
    .command('config:show')
    .description('Show current model configuration without revealing the full API key.')
    .action(async () => {
      const config = await loadConfig();
      if (!config) {
        console.log('No GPS Code config found. Run gps-code config:set first.');
        return;
      }
      console.log(JSON.stringify({...config, apiKey: '***'}, null, 2));
    });

  program.action(() => {
    render(React.createElement(App, {cwd: process.cwd()}));
  });

  return program;
}
```

- [ ] **Step 3: Implement executable entry**

Create `src/cli/index.ts`:

```ts
#!/usr/bin/env node
import {createProgram} from './commands.js';
import {formatError} from '../shared/errors.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: FAIL because `src/tui/App.tsx` has not been created yet. This is acceptable until Task 7.

- [ ] **Step 5: Commit after Task 7 instead of now**

Do not commit this task alone if typecheck fails. Commit CLI and TUI together after Task 7 passes.

---

### Task 7: Minimal Ink TUI

**Files:**
- Create: `src/tui/App.tsx`
- Create: `src/tui/components/ChatView.tsx`
- Create: `src/tui/components/InputBox.tsx`

- [ ] **Step 1: Implement ChatView**

Create `src/tui/components/ChatView.tsx`:

```tsx
import React from 'react';
import {Box, Text} from 'ink';

export type ChatMessageView = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function ChatView({messages}: {messages: ChatMessageView[]}) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={index} marginBottom={1} flexDirection="column">
          <Text color={message.role === 'user' ? 'cyan' : message.role === 'assistant' ? 'green' : 'yellow'}>
            {message.role === 'user' ? '你' : message.role === 'assistant' ? 'GPS Code' : '系统'}
          </Text>
          <Text>{message.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Implement InputBox**

Create `src/tui/components/InputBox.tsx`:

```tsx
import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export function InputBox({disabled, onSubmit}: {disabled?: boolean; onSubmit(input: string): void}) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      setValue('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (input) {
      setValue((current) => `${current}${input}`);
    }
  });

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="gray">{disabled ? '等待模型回复...' : '输入问题，回车发送：'}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Implement App**

Create `src/tui/App.tsx`:

```tsx
import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import {createAgent} from '../agent/agent.js';
import {loadConfig} from '../config/store.js';
import {createOpenAICompatibleClient} from '../model/openai-compatible.js';
import {buildRepoMap} from '../workspace/indexer.js';
import type {RepoMap} from '../workspace/types.js';
import {ChatView, type ChatMessageView} from './components/ChatView.js';
import {InputBox} from './components/InputBox.js';

export function App({cwd}: {cwd: string}) {
  const [messages, setMessages] = useState<ChatMessageView[]>([
    {role: 'system', content: '欢迎使用 GPS Code。正在分析当前项目...'}
  ]);
  const [repoMap, setRepoMap] = useState<RepoMap | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        const map = await buildRepoMap(cwd);
        setRepoMap(map);
        setMessages((current) => [
          ...current,
          {
            role: 'system',
            content: `项目分析完成：语言=${map.languages.join(', ') || '未知'}；关键文件=${map.keyFiles.join(', ') || '暂无'}`
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {role: 'system', content: `项目分析失败：${error instanceof Error ? error.message : String(error)}`}
        ]);
      } finally {
        setBusy(false);
      }
    }
    void boot();
  }, [cwd]);

  const canChat = useMemo(() => Boolean(repoMap) && !busy, [busy, repoMap]);

  async function handleSubmit(input: string) {
    if (!repoMap) return;
    setBusy(true);
    setMessages((current) => [...current, {role: 'user', content: input}]);
    try {
      const config = await loadConfig();
      if (!config) {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: '还没有配置模型。请先退出并运行 gps-code config:set --base-url <url> --api-key <key> --model <model>。'
          }
        ]);
        return;
      }
      const agent = createAgent({
        model: createOpenAICompatibleClient(config),
        repoMap
      });
      const answer = await agent.ask(input);
      setMessages((current) => [...current, {role: 'assistant', content: answer}]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {role: 'assistant', content: `请求失败：${error instanceof Error ? error.message : String(error)}`}
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">GPS Code</Text>
      <ChatView messages={messages} />
      <InputBox disabled={!canChat || busy} onSubmit={handleSubmit} />
    </Box>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS for config, workspace, model, and agent tests.

- [ ] **Step 6: Build package**

Run:

```bash
pnpm build
```

Expected: `dist/cli/index.js` is created.

- [ ] **Step 7: Smoke-test CLI help**

Run:

```bash
node dist/cli/index.js --help
```

Expected: help text includes `gps-code`, `config:set`, `config:show`, and `config:presets`.

- [ ] **Step 8: Commit CLI and TUI**

```bash
git add src/cli src/tui src/shared
git commit -m "feat: add GPS Code CLI and TUI shell"
```

---

### Task 8: Documentation And Release Readiness

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Create README**

Create `README.md`:

```md
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
```

- [ ] **Step 2: Add repository metadata**

Modify `package.json` to include:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/angus-guo/gps-code.git"
  },
  "bugs": {
    "url": "https://github.com/angus-guo/gps-code/issues"
  },
  "homepage": "https://github.com/angus-guo/gps-code#readme"
}
```

Keep all existing fields and insert these fields near `description`.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm test && pnpm typecheck && pnpm build
```

Expected: all commands pass.

- [ ] **Step 4: Commit docs**

```bash
git add README.md package.json
git commit -m "docs: add GPS Code README"
```

- [ ] **Step 5: Push branch**

Run:

```bash
git push
```

Expected: `master` pushes to `origin/master`.

---

## Self-Review

Spec coverage:

- M1 configurable TUI chat is covered by Tasks 1, 2, 4, 5, 6, and 7.
- M2 project understanding is covered by Task 3 and displayed in Task 7.
- P0 language priorities are covered by deterministic detectors for JS/TS, Python, Java, and C/C++.
- Senior engineer persona is covered by Task 5.
- Safe semi-automatic behavior is respected by excluding command execution and file modification from this plan.

Intentional gaps for later plans:

- M3 on-demand code search is not implemented here.
- M4 command confirmation, diff, and patch workflows are not implemented here.
- Rich TUI layout is not implemented here; the first TUI is a usable shell.

Placeholder scan:

- This plan contains no unresolved placeholder markers.
- Open implementation choices from the design spec are resolved for this plan: use `commander`, use fetch-based model client, use user-level config at `~/.gps-code/config.json`, and use a minimal Ink layout.

Type consistency:

- Config uses `ModelConfig` from `src/config/schema.ts`.
- Model client uses `ChatMessage`, `ModelClient`, and `ModelClientConfig` from `src/model/types.ts`.
- Agent accepts `ModelClient` and `RepoMap`.
- Workspace detector outputs merge into `RepoMap`.
