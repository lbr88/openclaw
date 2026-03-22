import { Type } from "@sinclair/typebox";

/**
 * Params for workflow.subscribe.
 *
 * The client may repeat this call to replace its active filter for the
 * connection. Repeated subscribe replaces the previous subscription.
 */
export const WorkflowSubscribeParamsSchema = Type.Object(
  {
    /**
     * Optional cursor: replay buffered events emitted after this cursor value.
     * Pass 0 (or omit) to receive only new events from this point forward.
     * The response includes `bufferHead` and `oldestCursor` so the client can
     * detect whether a gap has occurred and decide to do a full refresh.
     */
    afterCursor: Type.Optional(Type.Integer({ minimum: 0 })),
    /** If set, only deliver events matching these kinds. */
    kinds: Type.Optional(
      Type.Array(
        Type.String({
          enum: [
            "run.started",
            "run.completed",
            "run.failed",
            "subagent.spawned",
            "subagent.completed",
            "subagent.failed",
          ],
        }),
        { minItems: 1 },
      ),
    ),
    /** If set, only deliver events associated with this session key. */
    sessionKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Params for workflow.unsubscribe. */
export const WorkflowUnsubscribeParamsSchema = Type.Object({}, { additionalProperties: false });

/**
 * Shape of the `workflow.event` server-sent event payload.
 * Mirrors WorkflowEvent from the broker.
 */
export const WorkflowEventPayloadSchema = Type.Object(
  {
    id: Type.String(),
    cursor: Type.Integer({ minimum: 1 }),
    kind: Type.String(),
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    parentSessionKey: Type.Optional(Type.String()),
    childSessionKey: Type.Optional(Type.String()),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

export type WorkflowSubscribeKind =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "subagent.spawned"
  | "subagent.completed"
  | "subagent.failed";

export type WorkflowSubscribeParams = {
  afterCursor?: number;
  kinds?: WorkflowSubscribeKind[];
  sessionKey?: string;
};

export type WorkflowUnsubscribeParams = Record<string, never>;
