import {seniorEngineerSystemPrompt} from './prompts.js';
import type {CommandResult} from '../commands/types.js';
import type {ChatMessage, ModelClient, ToolCall} from '../model/types.js';
import {getProposedCommand} from '../tools/propose-command.js';
import {getProposedFileEdits} from '../tools/propose-file-edits.js';
import {executeToolCall, getToolDefinitionsForModel} from '../tools/registry.js';
import type {ToolActivity, ToolResult} from '../tools/types.js';
import type {RepoMap} from '../workspace/types.js';

export type Agent = {
  ask(input: string): Promise<string>;
  summarizeCommandResult(result: CommandResult): Promise<string>;
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
      content: [
        '当前项目 repo map 如下。你可以使用工具读取更多项目证据。',
        '如果你想建议用户运行命令，必须使用 propose_command 工具提出命令；命令不会自动执行，最终回答必须说明需要用户确认后才会运行。',
        '如果用户要求修改代码，先使用只读工具检查准确内容，再使用 propose_file_edits 提出精确编辑；该工具不会写入文件，最终回答必须说明需要用户查看 Diff 并确认后才会应用。',
        '回答时必须说明依据；如果证据不足，说明还需要检查什么。',
        '',
        formatRepoMap(repoMap)
      ].join('\n')
    },
    {role: 'user', content: input}
  ];
}

function createCommandResultSummaryMessages(repoMap: RepoMap, result: CommandResult): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是 GPS Code 的资深软件开发工程师。',
        '请用简体中文简洁总结刚刚完成的命令执行结果。',
        '先给出成功、失败或超时结论，再说明最重要的 stdout/stderr 发现和建议的下一步。',
        '如果输出已截断，必须明确提醒用户当前只能看到部分输出。',
        '不要复述大段原始输出，不要编造命令结果中不存在的信息。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '项目概况：',
        formatRepoMap(repoMap),
        '',
        '命令执行结果：',
        JSON.stringify(result, null, 2)
      ].join('\n')
    }
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
      metadata: result.modelMetadata ?? result.metadata ?? {}
    },
    null,
    2
  );
}

function addCommandConfirmationNotice(content: string) {
  return `${content}\n\n命令尚未执行；请在 TUI 中确认后我才会运行它。`;
}

function addEditConfirmationNotice(content: string) {
  return `${content}\n\n文件尚未修改；请在 TUI 中查看 Diff 并确认后我才会应用编辑。`;
}

export function createAgent(options: AgentOptions): Agent {
  const maxToolRounds = options.maxToolRounds ?? 4;
  const tools = getToolDefinitionsForModel();

  async function runTool(toolCall: ToolCall): Promise<{
    message: ChatMessage;
    proposedCommand: boolean;
    proposedEdit: boolean;
  }> {
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
      const proposedCommand = getProposedCommand(result.metadata);
      if (proposedCommand) {
        options.onToolActivity?.({
          toolName: toolCall.name,
          input: toolCall.arguments,
          status: 'proposed',
          summary: `Command proposed: ${proposedCommand.command}`,
          command: proposedCommand
        });
      }
      const proposedEdit = getProposedFileEdits(result.metadata);
      if (proposedEdit) {
        options.onToolActivity?.({
          toolName: toolCall.name,
          input: toolCall.arguments,
          status: 'edit-proposed',
          summary: `Edit proposed: ${proposedEdit.proposal.summary}`,
          editProposal: proposedEdit
        });
      }

      return {
        message: {
          role: 'tool',
          toolCallId: toolCall.id,
          content: formatToolResult(result)
        },
        proposedCommand: Boolean(proposedCommand),
        proposedEdit: Boolean(proposedEdit)
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
      let proposedCommandSeen = false;
      let proposedEditSeen = false;

      while (true) {
        const response = await options.model.complete({messages, tools});
        if (response.toolCalls.length === 0) {
          if (!response.content) {
            throw new Error('Model response did not include assistant content.');
          }
          let content = response.content;
          if (proposedCommandSeen) {
            content = addCommandConfirmationNotice(content);
          }
          if (proposedEditSeen) {
            content = addEditConfirmationNotice(content);
          }
          return content;
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
          const result = await runTool(toolCall);
          proposedCommandSeen = proposedCommandSeen || result.proposedCommand;
          proposedEditSeen = proposedEditSeen || result.proposedEdit;
          messages.push(result.message);
        }
        toolRounds += 1;
      }
    },

    async summarizeCommandResult(result: CommandResult) {
      const response = await options.model.complete({
        messages: createCommandResultSummaryMessages(options.repoMap, result)
      });
      const summary = response.content.trim();
      if (!summary) {
        throw new Error('Model returned an empty command result summary.');
      }
      return summary;
    }
  };
}
