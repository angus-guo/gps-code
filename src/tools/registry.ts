import {listFilesTool} from './list-files.js';
import {proposeCommandTool} from './propose-command.js';
import {proposeFileEditsTool} from './propose-file-edits.js';
import {readFileTool} from './read-file.js';
import {searchTextTool} from './search-text.js';
import type {ModelToolDefinition} from '../model/types.js';
import type {ToolContext, ToolDefinition, ToolResult} from './types.js';

export const builtinTools = [
  listFilesTool,
  readFileTool,
  searchTextTool,
  proposeCommandTool,
  proposeFileEditsTool
] as const satisfies readonly ToolDefinition<unknown>[];

type AnyTool = ToolDefinition<unknown>;

const toolParameterSchemas: Record<string, ModelToolDefinition['function']['parameters']> = {
  list_files: {
    type: 'object',
    properties: {
      path: {type: 'string', description: 'Optional workspace-relative directory to list.'},
      limit: {type: 'integer', minimum: 1, maximum: 1000, default: 200}
    },
    additionalProperties: false
  },
  read_file: {
    type: 'object',
    properties: {
      path: {type: 'string', description: 'Workspace-relative file path to read.'},
      maxBytes: {type: 'integer', minimum: 1, maximum: 1000000, default: 64000}
    },
    required: ['path'],
    additionalProperties: false
  },
  search_text: {
    type: 'object',
    properties: {
      query: {type: 'string', description: 'Text to search for.'},
      path: {type: 'string', description: 'Optional workspace-relative directory or file to search.'},
      limit: {type: 'integer', minimum: 1, maximum: 1000, default: 50}
    },
    required: ['query'],
    additionalProperties: false
  },
  propose_command: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Executable name or path. Do not include shell syntax; pass arguments separately.'
      },
      args: {
        type: 'array',
        items: {type: 'string'},
        description: 'Command arguments as argv items, with no shell interpolation.',
        default: []
      },
      cwd: {type: 'string', description: 'Optional workspace-relative working directory.'},
      timeoutMs: {type: 'integer', minimum: 1, maximum: 600000, default: 30000},
      maxOutputBytes: {type: 'integer', minimum: 1, maximum: 10000000, default: 64000},
      reason: {type: 'string', description: 'Brief reason why this command is useful.'}
    },
    required: ['command'],
    additionalProperties: false
  },
  propose_file_edits: {
    type: 'object',
    properties: {
      summary: {type: 'string', description: 'Brief purpose of the complete edit proposal.'},
      files: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: 'Small set of workspace text files to create or update.',
        items: {
          type: 'object',
          properties: {
            path: {type: 'string', description: 'Workspace-relative text file path.'},
            reason: {type: 'string', description: 'Why this file needs to change.'},
            action: {type: 'string', enum: ['create', 'update']},
            operations: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              description: 'Exact text replacements applied in order.',
              items: {
                type: 'object',
                properties: {
                  oldText: {
                    type: 'string',
                    description: 'Exact unique current text. Use an empty string only when creating a file.'
                  },
                  newText: {type: 'string', description: 'Replacement text or complete new file content.'}
                },
                required: ['oldText', 'newText'],
                additionalProperties: false
              }
            }
          },
          required: ['path', 'reason', 'action', 'operations'],
          additionalProperties: false
        }
      }
    },
    required: ['summary', 'files'],
    additionalProperties: false
  }
};

export function createToolRegistry(tools: readonly AnyTool[] = builtinTools) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    names() {
      return [...byName.keys()];
    },

    get(name: string) {
      return byName.get(name);
    },

    getToolDefinitionsForModel(): ModelToolDefinition[] {
      return [...byName.values()].map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toolParameterSchemas[tool.name] ?? {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        }
      }));
    },

    async executeToolCall(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const parsed = tool.inputSchema.parse(input);
      return tool.execute(parsed, context);
    }
  };
}

const defaultRegistry = createToolRegistry();

export function getToolDefinitionsForModel() {
  return defaultRegistry.getToolDefinitionsForModel();
}

export function executeToolCall(name: string, input: unknown, context: ToolContext) {
  return defaultRegistry.executeToolCall(name, input, context);
}
