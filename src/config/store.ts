import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {modelConfigSchema, type ModelConfig} from './schema.js';

export type ConfigStoreOptions = {
  homeDir?: string;
};

function getHomeDir(options: ConfigStoreOptions = {}) {
  return options.homeDir ?? process.env.HOME ?? process.cwd();
}

export function getConfigPath(options: ConfigStoreOptions = {}) {
  return join(getHomeDir(options), '.gps-code', 'config.json');
}

export async function loadConfig(options: ConfigStoreOptions = {}): Promise<ModelConfig | null> {
  try {
    const raw = await readFile(getConfigPath(options), 'utf8');
    return modelConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function saveConfig(config: ModelConfig, options: ConfigStoreOptions = {}) {
  const parsed = modelConfigSchema.parse(config);
  const configPath = getConfigPath(options);
  const configDir = join(getHomeDir(options), '.gps-code');
  await mkdir(configDir, {recursive: true, mode: 0o700});
  await chmod(configDir, 0o700);
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  await chmod(configPath, 0o600);
}
