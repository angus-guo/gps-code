import {z} from 'zod';
import {isPermissionMode, type PermissionMode} from '../permissions/types.js';

export const modelConfigSchema = z.object({
  baseURL: z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
      },
      {message: 'baseURL must use http or https'}
    ),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(4096),
  // Command lines that skip confirmation, e.g. ["pnpm test", "git status *"].
  // Cannot override a built-in block; see permissions/policy.ts.
  allowlist: z.array(z.string()).optional(),
  // Command lines that are always refused, checked before anything else.
  denylist: z.array(z.string()).optional(),
  // Permission mode restored at startup; written when /mode switches modes.
  permissionMode: z
    .custom<PermissionMode>((value) => typeof value === 'string' && isPermissionMode(value))
    .optional()
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export type ProviderPreset = {
  name: string;
  label: string;
  baseURL: string;
  defaultModel: string;
};

export const providerPresets: ProviderPreset[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  {
    name: 'qwen',
    label: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus'
  },
  {
    name: 'kimi',
    label: 'Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k'
  },
  {
    name: 'ollama',
    label: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder'
  }
];
