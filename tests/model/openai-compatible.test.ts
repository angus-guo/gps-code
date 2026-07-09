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
