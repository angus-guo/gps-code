import {z} from 'zod';

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
  maxTokens: z.number().int().positive().default(4096)
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
