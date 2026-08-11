import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  builtinTools,
  createToolRegistry,
  executeToolCall,
  getToolDefinitionsForModel
} from '../../src/tools/registry.js';
import {MAX_EDIT_FILES, MAX_EDIT_OPERATIONS_PER_FILE} from '../../src/edits/types.js';

let tempDirs: string[] = [];

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-registry-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('tool registry', () => {
  it('exposes built-in tools', () => {
    const registry = createToolRegistry(builtinTools);

    expect(registry.names()).toEqual([
      'list_files',
      'read_file',
      'search_text',
      'propose_command',
      'propose_file_edits'
    ]);
  });

  it('rejects unknown tool names', async () => {
    const root = await makeProject();

    await expect(executeToolCall('missing_tool', {}, {root})).rejects.toThrow(/unknown tool/i);
  });

  it('validates tool input before execution', async () => {
    const root = await makeProject();

    await expect(executeToolCall('read_file', {}, {root})).rejects.toThrow();
  });

  it('executes a known tool with parsed input', async () => {
    const root = await makeProject();
    await writeFile(join(root, 'README.md'), 'hello gps\n', 'utf8');

    const result = await executeToolCall('read_file', {path: 'README.md'}, {root});

    expect(result.content).toBe('hello gps\n');
    expect(result.metadata).toMatchObject({path: 'README.md', lineCount: 1});
  });

  it('converts tools into OpenAI-compatible tool definitions', () => {
    const definitions = getToolDefinitionsForModel();

    expect(definitions).toEqual([
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: expect.any(String),
          parameters: {
            type: 'object',
            properties: {
              path: {type: 'string', description: expect.any(String)},
              limit: {type: 'integer', minimum: 1, maximum: 1000, default: 200}
            },
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: expect.any(String),
          parameters: {
            type: 'object',
            properties: {
              path: {type: 'string', description: expect.any(String)},
              maxBytes: {type: 'integer', minimum: 1, maximum: 1000000, default: 64000}
            },
            required: ['path'],
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_text',
          description: expect.any(String),
          parameters: {
            type: 'object',
            properties: {
              query: {type: 'string', description: expect.any(String)},
              path: {type: 'string', description: expect.any(String)},
              limit: {type: 'integer', minimum: 1, maximum: 1000, default: 50}
            },
            required: ['query'],
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'propose_command',
          description: expect.any(String),
          parameters: {
            type: 'object',
            properties: {
              command: {type: 'string', description: expect.any(String)},
              args: {
                type: 'array',
                items: {type: 'string'},
                description: expect.any(String),
                default: []
              },
              cwd: {type: 'string', description: expect.any(String)},
              timeoutMs: {type: 'integer', minimum: 1, maximum: 600000, default: 30000},
              maxOutputBytes: {type: 'integer', minimum: 1, maximum: 10000000, default: 64000},
              reason: {type: 'string', description: expect.any(String)}
            },
            required: ['command'],
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'propose_file_edits',
          description: expect.any(String),
          parameters: {
            type: 'object',
            properties: {
              summary: {type: 'string', description: expect.any(String)},
              files: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_EDIT_FILES,
                description: expect.any(String),
                items: {
                  type: 'object',
                  properties: {
                    path: {type: 'string', description: expect.any(String)},
                    reason: {type: 'string', description: expect.any(String)},
                    action: {type: 'string', enum: ['create', 'update']},
                    operations: {
                      type: 'array',
                      minItems: 1,
                      maxItems: MAX_EDIT_OPERATIONS_PER_FILE,
                      description: expect.any(String),
                      items: {
                        type: 'object',
                        properties: {
                          oldText: {type: 'string', description: expect.any(String)},
                          newText: {type: 'string', description: expect.any(String)}
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
        }
      }
    ]);
  });
});
