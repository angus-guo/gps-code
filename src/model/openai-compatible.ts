import type {
  ChatMessage,
  ModelClient,
  ModelClientConfig,
  ModelRequest,
  ModelResponse,
  ToolCall
} from './types.js';

type OpenAIMessage =
  | {
    role: 'system' | 'user';
    content: string;
  }
  | {
    role: 'assistant';
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }
  | {
    role: 'tool';
    tool_call_id: string;
    content: string;
  };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function joinURL(baseURL: string, path: string) {
  return `${baseURL.replace(/\/+$/, '')}${path}`;
}

function stringifyToolArguments(args: unknown) {
  return JSON.stringify(args ?? {});
}

function parseToolArguments(raw: string | undefined) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function toOpenAIMessage(message: ChatMessage): OpenAIMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? null,
      ...(message.toolCalls?.length
        ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.name,
              arguments: stringifyToolArguments(toolCall.arguments)
            }
          }))
        }
        : {})
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function parseToolCalls(response: ChatCompletionResponse): ToolCall[] {
  return (response.choices?.[0]?.message?.tool_calls ?? [])
    .map((toolCall) => {
      const id = toolCall.id;
      const name = toolCall.function?.name;
      if (!id || !name || toolCall.type !== 'function') {
        return null;
      }

      return {
        id,
        name,
        arguments: parseToolArguments(toolCall.function?.arguments)
      };
    })
    .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));
}

export function createOpenAICompatibleClient(config: ModelClientConfig): ModelClient {
  async function complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(joinURL(config.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.tools?.length ? {tools: request.tools} : {}),
        temperature: config.temperature,
        max_tokens: config.maxTokens
      })
    });

    const data = (await response.json()) as ChatCompletionResponse;

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Model request failed with status ${response.status}`);
    }

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      toolCalls: parseToolCalls(data)
    };
  }

  return {
    async chat(messages: ChatMessage[]) {
      const response = await complete({messages});
      if (!response.content) {
        throw new Error('Model response did not include assistant content.');
      }
      return response.content;
    },
    complete
  };
}
