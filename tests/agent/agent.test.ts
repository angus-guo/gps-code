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
