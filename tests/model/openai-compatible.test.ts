import {afterEach, describe, expect, it, vi} from 'vitest';
import {createOpenAICompatibleClient} from '../../src/model/openai-compatible.js';
import {ModelRequestAbortedError} from '../../src/model/types.js';

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

  it('sends tool definitions and returns assistant tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"README.md"}'
                  }
                }
              ]
            }
          }
        ]
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

    await expect(
      client.complete({
        messages: [{role: 'user', content: '读取 README'}],
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read a file',
              parameters: {
                type: 'object',
                properties: {path: {type: 'string'}},
                required: ['path'],
                additionalProperties: false
              }
            }
          }
        ]
      })
    ).resolves.toEqual({
      content: '',
      toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {path: {type: 'string'}},
            required: ['path'],
            additionalProperties: false
          }
        }
      }
    ]);
  });

  it('sends tool result messages back to the model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{message: {role: 'assistant', content: 'README 内容已读取。'}}]
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

    await client.complete({
      messages: [
        {role: 'assistant', content: '', toolCalls: [{id: 'call_1', name: 'read_file', arguments: {path: 'README.md'}}]},
        {role: 'tool', toolCallId: 'call_1', content: 'GPS Code README'}
      ]
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {name: 'read_file', arguments: '{"path":"README.md"}'}
          }
        ]
      },
      {role: 'tool', tool_call_id: 'call_1', content: 'GPS Code README'}
    ]);
  });

  it('complete returns plain assistant text without tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{message: {role: 'assistant', content: '普通回答'}}]
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

    await expect(client.complete({messages: [{role: 'user', content: '你好'}]})).resolves.toEqual({
      content: '普通回答',
      toolCalls: []
    });
  });

  it('forwards the abort signal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({choices: [{message: {role: 'assistant', content: 'ok'}}]})
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const client = createOpenAICompatibleClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 1024
    });

    await client.complete({messages: [{role: 'user', content: '你好'}], signal: controller.signal});

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('translates a fetch AbortError into ModelRequestAbortedError', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'});
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAICompatibleClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 1024
    });

    await expect(client.complete({messages: [{role: 'user', content: '你好'}]}))
      .rejects.toBeInstanceOf(ModelRequestAbortedError);
  });

  it('does not call fetch when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort();

    const client = createOpenAICompatibleClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 1024
    });

    await expect(
      client.complete({messages: [{role: 'user', content: '你好'}], signal: controller.signal})
    ).rejects.toBeInstanceOf(ModelRequestAbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still surfaces non-abort network errors unchanged', async () => {
    const networkError = new Error('socket hang up');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    const client = createOpenAICompatibleClient({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'demo-model',
      temperature: 0.2,
      maxTokens: 1024
    });

    await expect(client.complete({messages: [{role: 'user', content: '你好'}]}))
      .rejects.toThrow('socket hang up');
  });
});
