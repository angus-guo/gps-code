import {mkdtemp, rm, writeFile} from 'node:fs/promises';
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
    expect(calls[0].tools?.map((tool) => tool.function.name)).toEqual(['list_files', 'read_file', 'search_text']);
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
});
