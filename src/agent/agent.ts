import {seniorEngineerSystemPrompt} from './prompts.js';
import type {ChatMessage, ModelClient, ToolCall} from '../model/types.js';
import {executeToolCall, getToolDefinitionsForModel} from '../tools/registry.js';
import type {ToolActivity, ToolResult} from '../tools/types.js';
import type {RepoMap} from '../workspace/types.js';

export type Agent = {
  ask(input: string): Promise<string>;
};

export type AgentOptions = {
  model: ModelClient;
  repoMap: RepoMap;
  maxToolRounds?: number;
  onToolActivity?: (activity: ToolActivity) => void;
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

function createInitialMessages(repoMap: RepoMap, input: string): ChatMessage[] {
  return [
    {role: 'system', content: seniorEngineerSystemPrompt},
    {
      role: 'system',
      content: `当前项目 repo map 如下。你可以使用工具读取更多项目证据。回答时必须说明依据；如果证据不足，说明还需要检查什么。\n\n${formatRepoMap(repoMap)}`
    },
    {role: 'user', content: input}
  ];
}

function summarizeToolInput(input: unknown) {
  if (!input || typeof input !== 'object') {
    return '';
  }
  const values = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}=${String(value)}`);
  return values.length ? ` (${values.join(', ')})` : '';
}

function formatToolResult(result: ToolResult) {
  return JSON.stringify(
    {
      content: result.content,
      metadata: result.metadata ?? {}
    },
    null,
    2
  );
}

export function createAgent(options: AgentOptions): Agent {
  const maxToolRounds = options.maxToolRounds ?? 4;
  const tools = getToolDefinitionsForModel();

  async function runTool(toolCall: ToolCall): Promise<ChatMessage> {
    const summarySuffix = summarizeToolInput(toolCall.arguments);
    options.onToolActivity?.({
      toolName: toolCall.name,
      input: toolCall.arguments,
      status: 'started',
      summary: `Running ${toolCall.name}${summarySuffix}`
    });

    try {
      const result = await executeToolCall(toolCall.name, toolCall.arguments, {root: options.repoMap.root});
      options.onToolActivity?.({
        toolName: toolCall.name,
        input: toolCall.arguments,
        status: 'completed',
        summary: `${toolCall.name} completed`
      });

      return {
        role: 'tool',
        toolCallId: toolCall.id,
        content: formatToolResult(result)
      };
    } catch (error) {
      options.onToolActivity?.({
        toolName: toolCall.name,
        input: toolCall.arguments,
        status: 'failed',
        summary: `${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`
      });
      throw error;
    }
  }

  return {
    async ask(input: string) {
      const messages = createInitialMessages(options.repoMap, input);
      let toolRounds = 0;

      while (true) {
        const response = await options.model.complete({messages, tools});
        if (response.toolCalls.length === 0) {
          if (!response.content) {
            throw new Error('Model response did not include assistant content.');
          }
          return response.content;
        }

        if (toolRounds >= maxToolRounds) {
          throw new Error(`Maximum tool rounds exceeded (${maxToolRounds}).`);
        }

        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls
        });
        for (const toolCall of response.toolCalls) {
          messages.push(await runTool(toolCall));
        }
        toolRounds += 1;
      }
    }
  };
}
