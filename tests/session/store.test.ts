import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  createSessionStore,
  getSessionsRoot
} from '../../src/session/store.js';

let tempDirs: string[] = [];

async function makeEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-session-'));
  tempDirs.push(root);
  const homeDir = join(root, 'home');
  const workspace = join(root, 'workspace');
  const {mkdir} = await import('node:fs/promises');
  await mkdir(homeDir);
  await mkdir(workspace);
  return {root, homeDir, workspace};
}

function getSessionPath(homeDir: string, workspaceId: string, sessionId: string) {
  return join(getSessionsRoot({homeDir}), workspaceId, `${sessionId}.jsonl`);
}

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, {recursive: true, force: true})));
  tempDirs = [];
});

describe('session store', () => {
  it('creates, appends, and loads a versioned workspace session', async () => {
    const {homeDir, workspace} = await makeEnvironment();
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);
    const canonicalWorkspace = await realpath(workspace);

    const first = await store.appendEvent(workspace, created.metadata.id, {
      role: 'user',
      kind: 'default',
      content: '入口文件在哪里？'
    });
    const second = await store.appendEvent(workspace, created.metadata.id, {
      role: 'assistant',
      kind: 'default',
      content: '入口位于 src/cli/index.ts。'
    });
    const loaded = await store.loadSession(workspace, created.metadata.id);

    expect(created.metadata).toMatchObject({
      recordType: 'session',
      schemaVersion: 1,
      workspaceRoot: canonicalWorkspace
    });
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(loaded?.events.map(({role, content}) => ({role, content}))).toEqual([
      {role: 'user', content: '入口文件在哪里？'},
      {role: 'assistant', content: '入口位于 src/cli/index.ts。'}
    ]);
    expect(loaded?.recoveredFromCorruption).toBe(false);
  });

  it('uses the same workspace identity for a symbolic path to the root', async () => {
    const {root, homeDir, workspace} = await makeEnvironment();
    const linkedWorkspace = join(root, 'linked-workspace');
    await symlink(workspace, linkedWorkspace);
    const store = createSessionStore({homeDir});
    const created = await store.createSession(linkedWorkspace);
    const canonicalWorkspace = await realpath(workspace);

    expect(created.metadata.workspaceRoot).toBe(canonicalWorkspace);
    await expect(store.loadSession(workspace, created.metadata.id)).resolves.toMatchObject({
      metadata: {id: created.metadata.id}
    });
  });

  it('enforces private permissions on directories and files', async () => {
    const {homeDir, workspace} = await makeEnvironment();
    const gpsCodeDirectory = join(homeDir, '.gps-code');
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);
    const workspaceDirectory = join(getSessionsRoot({homeDir}), created.metadata.workspaceId);
    const sessionPath = join(workspaceDirectory, `${created.metadata.id}.jsonl`);
    const latestPath = join(workspaceDirectory, 'latest.json');

    await chmod(gpsCodeDirectory, 0o777);
    await store.appendEvent(workspace, created.metadata.id, {
      role: 'system',
      kind: 'tool',
      content: '工具完成'
    });

    expect((await stat(gpsCodeDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(getSessionsRoot({homeDir}))).mode & 0o777).toBe(0o700);
    expect((await stat(workspaceDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    expect((await stat(latestPath)).mode & 0o777).toBe(0o600);
  });

  it('recovers the valid prefix of a corrupt trailing record and refuses appends', async () => {
    const {homeDir, workspace} = await makeEnvironment();
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);
    await store.appendEvent(workspace, created.metadata.id, {
      role: 'user',
      kind: 'default',
      content: '保留这条消息'
    });
    const sessionPath = getSessionPath(homeDir, created.metadata.workspaceId, created.metadata.id);
    await appendFile(sessionPath, '{"recordType":"event"', 'utf8');

    const recovered = await store.loadSession(workspace, created.metadata.id);

    expect(recovered?.events).toHaveLength(1);
    expect(recovered).toMatchObject({recoveredFromCorruption: true, corruptedLine: 3});
    await expect(store.appendEvent(workspace, created.metadata.id, {
      role: 'assistant',
      kind: 'default',
      content: '不能追加'
    })).rejects.toThrow(/corrupted session/i);
  });

  it('isolates workspaces and resolves the latest valid session', async () => {
    const {root, homeDir, workspace} = await makeEnvironment();
    const otherWorkspace = join(root, 'other-workspace');
    const {mkdir} = await import('node:fs/promises');
    await mkdir(otherWorkspace);
    let tick = 0;
    const store = createSessionStore({
      homeDir,
      now: () => new Date(Date.UTC(2026, 6, 18, 0, 0, tick++))
    });
    const first = await store.createSession(workspace);
    const second = await store.createSession(workspace);
    const other = await store.createSession(otherWorkspace);
    await store.appendEvent(workspace, first.metadata.id, {
      role: 'user',
      kind: 'default',
      content: '让第一个会话重新成为最新会话'
    });

    expect((await store.listSessions(workspace)).map(({id}) => id)).toEqual([
      first.metadata.id,
      second.metadata.id
    ]);
    expect((await store.loadLatestSession(workspace))?.metadata.id).toBe(first.metadata.id);
    expect((await store.loadLatestSession(otherWorkspace))?.metadata.id).toBe(other.metadata.id);
    await expect(store.loadSession(otherWorkspace, first.metadata.id)).resolves.toBeNull();
  });

  it('falls back to scanning sessions when the latest pointer is corrupt', async () => {
    const {homeDir, workspace} = await makeEnvironment();
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);
    const latestPath = join(
      getSessionsRoot({homeDir}),
      created.metadata.workspaceId,
      'latest.json'
    );
    const {writeFile} = await import('node:fs/promises');
    await writeFile(latestPath, 'not json', 'utf8');

    expect((await store.loadLatestSession(workspace))?.metadata.id).toBe(created.metadata.id);
  });

  it('rejects traversal-shaped session identifiers and oversized events', async () => {
    const {homeDir, workspace} = await makeEnvironment();
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);

    await expect(store.loadSession(workspace, '../../config')).rejects.toThrow();
    await expect(store.appendEvent(workspace, created.metadata.id, {
      role: 'user',
      kind: 'default',
      content: 'x'.repeat(512_001)
    })).rejects.toThrow(/exceeds/i);
    expect((await readFile(getSessionPath(homeDir, created.metadata.workspaceId, created.metadata.id), 'utf8')).split('\n'))
      .toHaveLength(2);
  });

  it('refuses to read or append through a replaced session-file symlink', async () => {
    const {root, homeDir, workspace} = await makeEnvironment();
    const store = createSessionStore({homeDir});
    const created = await store.createSession(workspace);
    const sessionPath = getSessionPath(homeDir, created.metadata.workspaceId, created.metadata.id);
    const movedPath = join(root, 'moved-session.jsonl');
    await rename(sessionPath, movedPath);
    await symlink(movedPath, sessionPath);

    await expect(store.loadSession(workspace, created.metadata.id)).rejects.toThrow();
    await expect(store.appendEvent(workspace, created.metadata.id, {
      role: 'user',
      kind: 'default',
      content: '不能写入符号链接'
    })).rejects.toThrow();
    expect(await readFile(movedPath, 'utf8')).not.toContain('不能写入符号链接');
  });
});
