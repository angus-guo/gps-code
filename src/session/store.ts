import {createHash, randomUUID} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {
  latestSessionPointerSchema,
  MAX_SESSION_EVENT_CONTENT_BYTES,
  MAX_SESSION_RECORD_BYTES,
  SESSION_SCHEMA_VERSION,
  sessionEventInputSchema,
  sessionEventSchema,
  sessionIdSchema,
  sessionMetadataSchema,
  type LoadedSession,
  type SessionEvent,
  type SessionEventInput,
  type SessionMetadata,
  type SessionSummary
} from './types.js';

export type SessionStoreOptions = {
  homeDir?: string;
  now?: () => Date;
  createId?: () => string;
};

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function getHomeDir(options: SessionStoreOptions) {
  return options.homeDir ?? process.env.HOME ?? process.cwd();
}

export function getSessionsRoot(options: SessionStoreOptions = {}) {
  return join(getHomeDir(options), '.gps-code', 'sessions');
}

export function createWorkspaceId(canonicalWorkspaceRoot: string) {
  return createHash('sha256').update(canonicalWorkspaceRoot).digest('hex');
}

async function getCanonicalWorkspaceRoot(workspaceRoot: string) {
  const canonicalRoot = await realpath(workspaceRoot);
  if (!(await stat(canonicalRoot)).isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${workspaceRoot}`);
  }
  return canonicalRoot;
}

async function getWorkspaceLocation(workspaceRoot: string, options: SessionStoreOptions) {
  const canonicalRoot = await getCanonicalWorkspaceRoot(workspaceRoot);
  const workspaceId = createWorkspaceId(canonicalRoot);
  return {
    canonicalRoot,
    workspaceId,
    directory: join(getSessionsRoot(options), workspaceId)
  };
}

async function ensurePrivateDirectory(path: string) {
  await mkdir(path, {recursive: true, mode: 0o700});
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Session storage path is not a private directory: ${path}`);
  }
  await chmod(path, 0o700);
}

async function ensureSessionDirectories(directory: string, options: SessionStoreOptions) {
  const gpsCodeDirectory = join(getHomeDir(options), '.gps-code');
  await ensurePrivateDirectory(gpsCodeDirectory);
  await ensurePrivateDirectory(getSessionsRoot(options));
  await ensurePrivateDirectory(directory);
}

function serializeRecord(record: unknown) {
  const serialized = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_RECORD_BYTES) {
    throw new Error(`Session record exceeds ${MAX_SESSION_RECORD_BYTES} bytes.`);
  }
  return serialized;
}

async function writeNewPrivateFile(path: string, content: string) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function readPrivateFile(path: string) {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`Session storage path is not a regular file: ${path}`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function writePrivateFileAtomically(path: string, content: string, createId: () => string) {
  const tempPath = join(dirname(path), `.${basename(path)}-${createId()}.tmp`);
  try {
    await writeNewPrivateFile(tempPath, content);
    await rename(tempPath, path);
    await chmod(path, 0o600);
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // The temporary file is normally moved into place.
    }
  }
}

function getSessionPath(directory: string, sessionId: string) {
  const parsedId = sessionIdSchema.parse(sessionId);
  return join(directory, `${parsedId}.jsonl`);
}

function parseSessionFile(raw: string, expectedRoot: string, expectedWorkspaceId: string): LoadedSession {
  const lines = raw.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    throw new Error('Session file is empty.');
  }

  let metadata: SessionMetadata;
  try {
    if (Buffer.byteLength(lines[0], 'utf8') > MAX_SESSION_RECORD_BYTES) {
      throw new Error('Session metadata record is too large.');
    }
    metadata = sessionMetadataSchema.parse(JSON.parse(lines[0]));
  } catch (error) {
    throw new Error(`Session metadata is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (metadata.workspaceId !== expectedWorkspaceId || metadata.workspaceRoot !== expectedRoot) {
    throw new Error('Session does not belong to the current workspace.');
  }

  const events: SessionEvent[] = [];
  let corruptedLine: number | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    try {
      if (Buffer.byteLength(lines[index], 'utf8') > MAX_SESSION_RECORD_BYTES) {
        throw new Error('Session event record is too large.');
      }
      const event = sessionEventSchema.parse(JSON.parse(lines[index]));
      if (event.sessionId !== metadata.id || event.sequence !== events.length) {
        throw new Error('Session event identity or sequence is invalid.');
      }
      events.push(event);
    } catch {
      corruptedLine = index + 1;
      break;
    }
  }

  return {
    metadata,
    events,
    recoveredFromCorruption: corruptedLine !== undefined,
    ...(corruptedLine === undefined ? {} : {corruptedLine})
  };
}

export function createSessionStore(options: SessionStoreOptions = {}) {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;

  async function writeLatestPointer(directory: string, sessionId: string) {
    const pointer = latestSessionPointerSchema.parse({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId
    });
    await writePrivateFileAtomically(
      join(directory, 'latest.json'),
      serializeRecord(pointer),
      createId
    );
  }

  async function loadSession(workspaceRoot: string, sessionId: string): Promise<LoadedSession | null> {
    const location = await getWorkspaceLocation(workspaceRoot, options);
    const path = getSessionPath(location.directory, sessionId);
    try {
      const raw = await readPrivateFile(path);
      return parseSessionFile(raw, location.canonicalRoot, location.workspaceId);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async function createSession(workspaceRoot: string): Promise<LoadedSession> {
    const location = await getWorkspaceLocation(workspaceRoot, options);
    await ensureSessionDirectories(location.directory, options);
    const metadata = sessionMetadataSchema.parse({
      recordType: 'session',
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: createId(),
      workspaceId: location.workspaceId,
      workspaceRoot: location.canonicalRoot,
      createdAt: now().toISOString()
    });
    await writeNewPrivateFile(
      getSessionPath(location.directory, metadata.id),
      serializeRecord(metadata)
    );
    await writeLatestPointer(location.directory, metadata.id);
    return {
      metadata,
      events: [],
      recoveredFromCorruption: false
    };
  }

  async function appendEvent(
    workspaceRoot: string,
    sessionId: string,
    input: SessionEventInput
  ): Promise<SessionEvent> {
    const location = await getWorkspaceLocation(workspaceRoot, options);
    await ensureSessionDirectories(location.directory, options);
    const loaded = await loadSession(location.canonicalRoot, sessionId);
    if (!loaded) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (loaded.recoveredFromCorruption) {
      throw new Error(`Cannot append to a corrupted session: ${sessionId}`);
    }
    const parsedInput = sessionEventInputSchema.parse(input);
    if (Buffer.byteLength(parsedInput.content, 'utf8') > MAX_SESSION_EVENT_CONTENT_BYTES) {
      throw new Error(`Session event content exceeds ${MAX_SESSION_EVENT_CONTENT_BYTES} bytes.`);
    }
    const event = sessionEventSchema.parse({
      recordType: 'event',
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: createId(),
      sessionId: loaded.metadata.id,
      sequence: loaded.events.length,
      timestamp: now().toISOString(),
      ...parsedInput
    });
    const path = getSessionPath(location.directory, loaded.metadata.id);
    const handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW
    );
    try {
      if (!(await handle.stat()).isFile()) {
        throw new Error(`Session storage path is not a regular file: ${path}`);
      }
      await handle.writeFile(serializeRecord(event), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(path, 0o600);
    await writeLatestPointer(location.directory, loaded.metadata.id);
    return event;
  }

  async function listSessions(workspaceRoot: string): Promise<SessionSummary[]> {
    const location = await getWorkspaceLocation(workspaceRoot, options);
    let entries;
    try {
      entries = await readdir(location.directory, {withFileTypes: true});
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(async (entry): Promise<SessionSummary | null> => {
        const sessionId = entry.name.slice(0, -'.jsonl'.length);
        try {
          const loaded = await loadSession(location.canonicalRoot, sessionId);
          if (!loaded) return null;
          return {
            ...loaded.metadata,
            updatedAt: loaded.events.at(-1)?.timestamp ?? loaded.metadata.createdAt,
            eventCount: loaded.events.length,
            recoveredFromCorruption: loaded.recoveredFromCorruption
          };
        } catch {
          return null;
        }
      }));

    return summaries
      .filter((summary): summary is SessionSummary => summary !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  async function loadLatestSession(workspaceRoot: string): Promise<LoadedSession | null> {
    const location = await getWorkspaceLocation(workspaceRoot, options);
    let pointedSessionId: string | null = null;
    try {
      const raw = await readPrivateFile(join(location.directory, 'latest.json'));
      try {
        const parsed = latestSessionPointerSchema.safeParse(JSON.parse(raw));
        pointedSessionId = parsed.success ? parsed.data.sessionId : null;
      } catch {
        // A malformed pointer can be rebuilt by scanning valid sessions.
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
    if (pointedSessionId) {
      const pointed = await loadSession(location.canonicalRoot, pointedSessionId);
      if (pointed) return pointed;
    }

    const [latest] = await listSessions(location.canonicalRoot);
    return latest ? loadSession(location.canonicalRoot, latest.id) : null;
  }

  return {
    createSession,
    appendEvent,
    loadSession,
    listSessions,
    loadLatestSession
  };
}
