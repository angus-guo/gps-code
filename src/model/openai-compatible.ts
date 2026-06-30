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
