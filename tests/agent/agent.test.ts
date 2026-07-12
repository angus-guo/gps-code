import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createAgent} from '../../src/agent/agent.js';
import type {ModelClient, ModelRequest} from '../../src/model/types.js';
import type {ToolActivity} from '../../src/tools/types.js';
import type {RepoMap} from '../../src/workspace/types.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-agent-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

function makeRepoMap(root: string): RepoMap {
  return {
    root,
    languages: ['javascript-typescript'],
    frameworks: ['vite'],
    packageManagers: ['pnpm'],
    buildTools: [],
    scripts: [{name: 'dev', command: 'vite', source: 'package.json'}],
    keyFiles: ['package.json', 'tsconfig.json'],
    keyDirectories: []
  };
}

describe('agent', () => {
  it('summarizes completed command results with project context', async () => {
    const root = await makeProject();
    const calls: ModelRequest[] = [];
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by command summarization');
      },
      async complete(request) {
        calls.push(request);
        return {content: '测试失败：有一个断言未通过，建议先检查 stderr 中的失败用例。', toolCalls: []};
      }
    };
    const agent = createAgent({model, repoMap: makeRepoMap(root)});

    await expect(agent.summarizeCommandResult({
      commandLine: 'pnpm test',
      cwd: root,
      exitCode: 1,
      timedOut: false,
      durationMs: 42,
      stdout: '10 tests passed',
      stderr: '1 test failed',
      truncated: true
    })).resolves.toContain('测试失败');

    expect(calls).toHaveLength(1);
    expect(calls[0].tools).toBeUndefined();
    expect(JSON.stringify(calls[0].messages)).toContain('pnpm test');
    expect(JSON.stringify(calls[0].messages)).toContain('1 test failed');
    expect(JSON.stringify(calls[0].messages)).toContain('输出已截断');
    expect(JSON.stringify(calls[0].messages)).toContain('package.json');
  });

  it('rejects an empty command result summary so the TUI can fall back', async () => {
    const root = await makeProject();
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by command summarization');
      },
      async complete() {
        return {content: '   ', toolCalls: []};
      }
    };
    const agent = createAgent({model, repoMap: makeRepoMap(root)});

    await expect(agent.summarizeCommandResult({
      commandLine: 'pnpm test',
      cwd: root,
      exitCode: 0,
      timedOut: false,
      durationMs: 42,
      stdout: 'ok',
      stderr: '',
      truncated: false
    })).rejects.toThrow(/empty command result summary/i);
  });

  it('adds senior engineer prompt and repo-map evidence to model messages', async () => {
    const root = await makeProject();
    const calls: ModelRequest[] = [];
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete(request) {
        calls.push(request);
        return {content: '结论：这是一个 TypeScript 项目。', toolCalls: []};
      }
    };

    const agent = createAgent({model, repoMap: makeRepoMap(root)});
    const answer = await agent.ask('这个项目怎么启动？');

    expect(answer).toContain('TypeScript');
    expect(JSON.stringify(calls[0].messages)).toContain('资深软件工程师');
    expect(JSON.stringify(calls[0].messages)).toContain('package.json');
    expect(JSON.stringify(calls[0].messages)).toContain('pnpm');
    expect(calls[0].tools?.map((tool) => tool.function.name)).toEqual([
      'list_files',
      'read_file',
      'search_text',
      'propose_command',
      'propose_file_edits'
    ]);
    expect(JSON.stringify(calls[0].messages)).toContain('需要用户确认后才会运行');
  });

  it('executes requested tools, sends tool results back, and returns final answer', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'README.md'), 'GPS Code README\n', 'utf8');
    const calls: ModelRequest[] = [];
    const activities: ToolActivity[] = [];
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            content: '',
            toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]
          };
        }

        return {content: '结论：README 说明这是 GPS Code。', toolCalls: []};
      }
    };

    const agent = createAgent({
      model,
      repoMap: makeRepoMap(root),
      onToolActivity(activity) {
        activities.push(activity);
      }
    });

    await expect(agent.ask('帮我解释 README')).resolves.toBe('结论：README 说明这是 GPS Code。');
    expect(calls).toHaveLength(2);
    expect(calls[1].messages).toEqual(
      expect.arrayContaining([
        {
          role: 'assistant',
          content: '',
          toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]
        },
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'call_1',
          content: expect.stringContaining('GPS Code README')
        })
      ])
    );
    expect(activities.map((activity) => activity.status)).toEqual(['started', 'completed']);
    expect(activities.map((activity) => activity.toolName)).toEqual(['read_file', 'read_file']);
  });

  it('stops after the configured maximum number of tool rounds', async () => {
    const root = await makeProject();
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete() {
        return {
          content: '',
          toolCalls: [{id: 'call_loop', name: 'list_files', arguments: {}}]
        };
      }
    };

    const agent = createAgent({model, repoMap: makeRepoMap(root), maxToolRounds: 1});

    await expect(agent.ask('一直列文件')).rejects.toThrow(/maximum tool rounds/i);
  });

  it('emits a command proposal activity when the model calls propose_command', async () => {
    const root = await makeProject();
    const calls: ModelRequest[] = [];
    const activities: ToolActivity[] = [];
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'call_command',
              name: 'propose_command',
              arguments: {command: 'pnpm', args: ['test'], reason: '运行测试'}
            }]
          };
        }

        return {content: '我已经准备好测试命令，需要你确认后才会运行。', toolCalls: []};
      }
    };

    const agent = createAgent({
      model,
      repoMap: makeRepoMap(root),
      onToolActivity(activity) {
        activities.push(activity);
      }
    });

    await expect(agent.ask('帮我验证项目')).resolves.toContain('命令尚未执行；请在 TUI 中确认后我才会运行它。');
    expect(calls).toHaveLength(2);
    expect(calls[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'call_command',
        content: expect.stringContaining('has not been executed')
      })
    ]));
    expect(activities.map((activity) => activity.status)).toEqual(['started', 'completed', 'proposed']);
    expect(activities.at(-1)).toMatchObject({
      toolName: 'propose_command',
      command: {command: 'pnpm', args: ['test']}
    });
  });

  it('emits a read-only edit proposal and requires user confirmation', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'app.ts'), 'const answer = 41;\n', 'utf8');
    const calls: ModelRequest[] = [];
    const activities: ToolActivity[] = [];
    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'call_edit',
              name: 'propose_file_edits',
              arguments: {
                summary: '修正答案',
                files: [{
                  path: 'app.ts',
                  reason: '修正错误常量',
                  action: 'update',
                  operations: [{oldText: '41', newText: '42'}]
                }]
              }
            }]
          };
        }

        return {content: '修改方案已经准备好，请查看 Diff。', toolCalls: []};
      }
    };
    const agent = createAgent({
      model,
      repoMap: makeRepoMap(root),
      onToolActivity(activity) {
        activities.push(activity);
      }
    });

    await expect(agent.ask('把答案改成 42')).resolves.toContain('文件尚未修改');
    expect(activities.map((activity) => activity.status)).toEqual([
      'started',
      'completed',
      'edit-proposed'
    ]);
    expect(activities.at(-1)?.editProposal?.proposal).toMatchObject({
      summary: '修正答案',
      files: [expect.objectContaining({path: 'app.ts', action: 'update'})]
    });
    const toolMessage = calls[1].messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).not.toContain('const answer = 41');
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('const answer = 41;\n');
  });
});
