import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {AgentSession} from '../../src/agent/agent.js';
import {ModelRequestAbortedError, type ModelClient, type ModelRequest} from '../../src/model/types.js';
import type {RepoMap} from '../../src/workspace/types.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-cancel-'));
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
    frameworks: [],
    packageManagers: ['pnpm'],
    buildTools: [],
    scripts: [],
    keyFiles: ['package.json'],
    keyDirectories: []
  };
}

/**
 * A model whose request never settles on its own — it only rejects when the
 * signal aborts, the way a real in-flight fetch behaves. This keeps the tests
 * deterministic: no timers, and no race where the mock finishes before the
 * test can cancel.
 */
function hangingModel(onRequest?: (request: ModelRequest) => void): ModelClient {
  return {
    async chat() {
      throw new Error('chat should not be used by the agent loop');
    },
    complete(request) {
      onRequest?.(request);
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => {
          reject(new ModelRequestAbortedError());
        });
      });
    }
  };
}

describe('AgentSession cancellation', () => {
  it('passes a live signal to the model and rejects when it aborts', async () => {
    const root = await makeProject();
    let seen: AbortSignal | undefined;
    const session = new AgentSession({
      model: hangingModel((request) => {
        seen = request.signal;
      }),
      repoMap: makeRepoMap(root)
    });

    const asking = session.ask('这个项目怎么启动？');
    // complete() is invoked synchronously before ask() yields, so the signal
    // is already captured here.
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);

    session.cancel();

    expect(seen?.aborted).toBe(true);
    await expect(asking).rejects.toBeInstanceOf(ModelRequestAbortedError);
  });

  it('cancels between tool rounds without another model call', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'README.md'), 'GPS Code\n', 'utf8');
    let completeCalls = 0;
    let session: AgentSession;

    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete() {
        completeCalls += 1;
        return {
          content: '',
          toolCalls: [{id: `call_${completeCalls}`, name: 'read_file', arguments: {path: 'README.md'}}]
        };
      }
    };

    session = new AgentSession({
      model,
      repoMap: makeRepoMap(root),
      onToolActivity(activity) {
        // Cancel the moment the first tool finishes, so the loop hits its
        // post-tool abort check instead of calling the model again.
        if (activity.status === 'completed') {
          session.cancel();
        }
      }
    });

    await expect(session.ask('读 README')).rejects.toBeInstanceOf(ModelRequestAbortedError);
    expect(completeCalls).toBe(1);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const root = await makeProject();
    let completeCalls = 0;
    let session: AgentSession;

    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete() {
        completeCalls += 1;
        // Cancel while the first response is still being produced.
        session.cancel();
        return {content: '', toolCalls: [{id: 'c1', name: 'list_files', arguments: {}}]};
      }
    };

    session = new AgentSession({model, repoMap: makeRepoMap(root)});

    await expect(session.ask('列文件')).rejects.toBeInstanceOf(ModelRequestAbortedError);
    expect(completeCalls).toBe(1);
  });

  it('is a no-op on an idle session', () => {
    const session = new AgentSession({
      model: hangingModel(),
      repoMap: makeRepoMap('/tmp/does-not-matter')
    });

    expect(() => session.cancel()).not.toThrow();
    expect(() => session.cancel()).not.toThrow();
  });

  it('leaves conversation history clean so the next turn is still valid', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'README.md'), 'GPS Code\n', 'utf8');
    const requests: ModelRequest[] = [];
    let cancelled = false;
    let session: AgentSession;

    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      async complete(request) {
        requests.push({...request, messages: [...request.messages]});
        if (!cancelled) {
          return {
            content: '',
            toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]
          };
        }
        return {content: '结论：这是 GPS Code。', toolCalls: []};
      }
    };

    session = new AgentSession({
      model,
      repoMap: makeRepoMap(root),
      onToolActivity(activity) {
        if (activity.status === 'completed' && !cancelled) {
          cancelled = true;
          session.cancel();
        }
      }
    });

    await expect(session.ask('第一次提问')).rejects.toBeInstanceOf(ModelRequestAbortedError);

    // A second turn must succeed, and must not carry the abandoned turn's
    // dangling user message or its unanswered assistant tool_calls message.
    await expect(session.ask('第二次提问')).resolves.toContain('GPS Code');

    const finalMessages = requests.at(-1)!.messages;
    expect(finalMessages.filter((message) => message.role === 'user')).toEqual([
      {role: 'user', content: '第二次提问'}
    ]);
    expect(finalMessages.some((message) => message.role === 'tool')).toBe(false);
    expect(
      finalMessages.some((message) => message.role === 'assistant' && 'toolCalls' in message)
    ).toBe(false);
    // The repo map was rolled back with the cancelled turn, so it is resent.
    expect(JSON.stringify(finalMessages)).toContain('package.json');
  });

  it('gives each turn a fresh signal', async () => {
    const root = await makeProject();
    const signals: (AbortSignal | undefined)[] = [];
    let hang = true;

    const model: ModelClient = {
      async chat() {
        throw new Error('chat should not be used by the agent loop');
      },
      complete(request) {
        signals.push(request.signal);
        if (hang) {
          return new Promise((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => {
              reject(new ModelRequestAbortedError());
            });
          });
        }
        return Promise.resolve({content: '第二轮回答。', toolCalls: []});
      }
    };

    const session = new AgentSession({model, repoMap: makeRepoMap(root)});

    const first = session.ask('第一次');
    session.cancel();
    await expect(first).rejects.toBeInstanceOf(ModelRequestAbortedError);

    hang = false;
    await expect(session.ask('第二次')).resolves.toBe('第二轮回答。');

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
