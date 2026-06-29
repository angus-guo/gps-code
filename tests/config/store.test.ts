import {chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
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

  it('writes config without group or world permissions', async () => {
    const homeDir = await makeTempHome();
    const configDir = join(homeDir, '.gps-code');
    const configPath = join(configDir, 'config.json');
    await mkdir(configDir, {recursive: true, mode: 0o777});
    await writeFile(configPath, '{}', {mode: 0o666});
    await chmod(configDir, 0o777);
    await chmod(configPath, 0o666);

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

    const dirPermissions = (await stat(configDir)).mode & 0o777;
    const filePermissions = (await stat(configPath)).mode & 0o777;
    expect(dirPermissions).toBe(0o700);
    expect(filePermissions).toBe(0o600);
    expect(dirPermissions & 0o077).toBe(0);
    expect(filePermissions & 0o077).toBe(0);
  });

  it('accepts HTTP and HTTPS base URLs', async () => {
    const homeDir = await makeTempHome();
    await saveConfig(
      {
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'test-key',
        model: 'qwen2.5-coder',
        temperature: 0.2,
        maxTokens: 4096
      },
      {homeDir}
    );

    await expect(loadConfig({homeDir})).resolves.toMatchObject({
      baseURL: 'http://localhost:11434/v1'
    });

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

    await expect(loadConfig({homeDir})).resolves.toMatchObject({
      baseURL: 'https://api.deepseek.com'
    });
  });

  it('rejects unsupported base URL schemes', async () => {
    const homeDir = await makeTempHome();
    await expect(
      saveConfig(
        {
          baseURL: 'ftp://example.com',
          apiKey: 'test-key',
          model: 'unsupported-scheme',
          temperature: 0.2,
          maxTokens: 4096
        },
        {homeDir}
      )
    ).rejects.toThrow();
  });
});
