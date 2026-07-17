import {z} from 'zod';

export const SESSION_SCHEMA_VERSION = 1;
export const MAX_SESSION_EVENT_CONTENT_BYTES = 512_000;
export const MAX_SESSION_RECORD_BYTES = 1_000_000;

export const sessionIdSchema = z.string().uuid();
export const workspaceIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const sessionMessageKindSchema = z.enum([
  'default',
  'tool',
  'command',
  'command-result',
  'edit-proposal',
  'edit-result'
]);

export const sessionMetadataSchema = z.object({
  recordType: z.literal('session'),
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  id: sessionIdSchema,
  workspaceId: workspaceIdSchema,
  workspaceRoot: z.string().min(1),
  createdAt: z.string().datetime()
}).strict();

export const sessionEventSchema = z.object({
  recordType: z.literal('event'),
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  id: sessionIdSchema,
  sessionId: sessionIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  role: z.enum(['user', 'assistant', 'system']),
  kind: sessionMessageKindSchema,
  content: z.string().refine(
    (content) => Buffer.byteLength(content, 'utf8') <= MAX_SESSION_EVENT_CONTENT_BYTES,
    `Session event content exceeds ${MAX_SESSION_EVENT_CONTENT_BYTES} bytes.`
  )
}).strict();

export const sessionEventInputSchema = sessionEventSchema.pick({
  role: true,
  kind: true,
  content: true
});

export const latestSessionPointerSchema = z.object({
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  sessionId: sessionIdSchema
}).strict();

export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionEventInput = z.input<typeof sessionEventInputSchema>;

export type LoadedSession = {
  metadata: SessionMetadata;
  events: SessionEvent[];
  recoveredFromCorruption: boolean;
  corruptedLine?: number;
};

export type SessionSummary = SessionMetadata & {
  updatedAt: string;
  eventCount: number;
  recoveredFromCorruption: boolean;
};
