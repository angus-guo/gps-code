import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadConfig, saveConfig} from '../../src/config/store.js';

let tempDirs: string[] = [];

async function makeTempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('config store', () => {
  it('returns null when config file is missing', async () => {
    const homeDir = await makeTempHome();
    await expect(loadConfig({homeDir})).resolves.toBeNull();
  });

  it('saves and loads model config', async () => {
    const homeDir = await makeTempHome();
    await saveConfig(
      {
        baseURL: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        temperature: 0.2,
        maxTokens: 4096
      },
      {homeDir}
    );

    await expect(loadConfig({homeDir})).resolves.toEqual({
      baseURL: 'https://api.deepseek.com',
      apiKey: 'test-key',
      model: 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 4096
    });

    const raw = await readFile(join(homeDir, '.gps-code', 'config.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({model: 'deepseek-chat'});
  });
});
