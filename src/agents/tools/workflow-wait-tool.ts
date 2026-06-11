/**
 * workflow_wait tool: pause the current orchestrator session turn until a
 * matching workflow event is emitted, or a timeout expires.
 *
 * ## Yield-then-wake pattern (orchestrator context)
 *
 * When `onYield` is provided (orchestrator turn with a yield mechanism):
 *   1. A one-shot waiter is registered in the broker.
 *   2. The current turn is ended immediately via `onYield` (like sessions_yield).
 *   3. When a matching event fires, the session is woken via a new gateway
 *      "agent" request carrying a `workflow_event` internalEvent so the
 *      orchestrator resumes with full event context.
 *
 * ## Blocking fallback (non-orchestrator context)
 *
 * When `onYield` is not provided, the tool falls back to awaiting the promise
 * directly. This is suitable for short-lived test or scripted contexts where
 * the session lock is not a concern.
 *
 * ## Self-wake guard
 *
 * If `callerSessionKey` is provided, events that originate from that session
 * are not considered as matches. This prevents an orchestrator from waking
 * itself on its own subagent.spawned event (which fires in the same turn).
 */

import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  clearWorkflowWaitersForSession,
  waitForWorkflowEvent,
  type WorkflowEventKind,
} from "../../infra/workflow-events.js";
import type { AgentWorkflowEventInternalEvent } from "../internal-events.js";
import { formatAgentInternalEventsForPrompt } from "../internal-events.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const VALID_KINDS: WorkflowEventKind[] = [
  "run.started",
  "run.completed",
  "run.failed",
  "subagent.spawned",
  "subagent.completed",
  "subagent.failed",
];

const WorkflowWaitToolSchema = Type.Object({
  /** Which event kinds to wait for. Omit or leave empty to accept any kind. */
  kinds: Type.Optional(
    Type.Array(
      Type.String({
        enum: VALID_KINDS,
      }),
    ),
  ),
  /**
   * Only match events associated with this session key (parentSessionKey,
   * childSessionKey, or sessionKey field on the event).
   */
  session_key: Type.Optional(Type.String()),
  /**
   * Maximum wait time in milliseconds. Defaults to 120 000 (2 minutes).
   * Use 0 to disable timeout (not recommended for production orchestrators).
   */
  timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
});

const DEFAULT_TIMEOUT_MS = 120_000;

export function createWorkflowWaitTool(opts?: {
  /** Session key of the calling orchestrator (used for self-wake guard and as wake target). */
  callerSessionKey?: string;
  /** Callback to end the current orchestrator turn (required for yield-then-wake). */
  onYield?: (message: string) => Promise<void> | void;
  /** Config for gateway calls (used when waking the session after event fires). */
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Wait for workflow event",
    name: "workflow_wait",
    description:
      "End this agent turn and resume later when a matching workflow event fires (e.g. subagent.completed), or fall back to blocking if no yield mechanism is available. Returns the matched event or a timeout error.",
    parameters: WorkflowWaitToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;

      const kindsRaw = Array.isArray(params.kinds) ? (params.kinds as string[]) : [];
      const kinds = kindsRaw.filter((k): k is WorkflowEventKind =>
        (VALID_KINDS as string[]).includes(k),
      );

      const sessionKey = readStringParam(params, "session_key") || undefined;
      const timeoutMs =
        typeof params.timeout_ms === "number" && params.timeout_ms >= 0
          ? params.timeout_ms
          : DEFAULT_TIMEOUT_MS;

      const filter = {
        kinds: kinds.length > 0 ? kinds : undefined,
        sessionKey,
      };

      // --- Yield-then-wake path (preferred, orchestrator context) ---
      if (opts?.onYield && opts?.callerSessionKey) {
        const callerKey = opts.callerSessionKey;
        const config = opts.config;

        // Register the waiter as a background promise — do NOT await it.
        const eventPromise = waitForWorkflowEvent(filter, timeoutMs, callerKey);

        // When the event fires, wake the session with a workflow_event internalEvent.
        eventPromise
          .then(async (evt) => {
            const internalEvent: AgentWorkflowEventInternalEvent = {
              type: "workflow_event",
              eventId: evt.id,
              kind: evt.kind,
              ts: evt.ts,
              sessionKey: evt.sessionKey,
              runId: evt.runId,
              parentSessionKey: evt.parentSessionKey,
              childSessionKey: evt.childSessionKey,
              data: evt.data,
            };
            const message = formatAgentInternalEventsForPrompt([internalEvent]);
            await callGateway({
              method: "agent",
              params: {
                sessionKey: callerKey,
                message,
                internalEvents: [internalEvent],
                deliver: false,
                idempotencyKey: `workflow_wake:${evt.id}:${callerKey}`,
              },
              config,
            });
          })
          .catch(() => {
            // Timeout or cancelled — session stays idle until the next external message.
          });

        // End the current turn immediately, like sessions_yield.
        await opts.onYield("Waiting for workflow event…");
        return jsonResult({
          status: "yielded",
          message: "Turn ended. Session will resume when a matching workflow event arrives.",
        });
      }

      // --- Blocking fallback (non-orchestrator or test context) ---
      try {
        const evt = await waitForWorkflowEvent(filter, timeoutMs, opts?.callerSessionKey);
        return jsonResult({
          status: "matched",
          event: {
            id: evt.id,
            cursor: evt.cursor,
            kind: evt.kind,
            ts: evt.ts,
            sessionKey: evt.sessionKey,
            runId: evt.runId,
            parentSessionKey: evt.parentSessionKey,
            childSessionKey: evt.childSessionKey,
            data: evt.data,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "timeout", error: message });
      }
    },
  };
}

/**
 * Cancel all pending workflow_wait calls for a session (call on teardown).
 * Delegates to the broker's waiter cleanup.
 */
export { clearWorkflowWaitersForSession };

/** Generate a stable idempotency key for a workflow wake call (exported for tests). */
export function buildWorkflowWakeIdempotencyKey(eventId: string, sessionKey: string): string {
  return `workflow_wake:${eventId}:${sessionKey}`;
}

// Re-export the kinds list for use in tests/configuration.
export const WORKFLOW_WAIT_VALID_KINDS: readonly WorkflowEventKind[] = VALID_KINDS;

/** Unique waiter id generator (exported for tests). */
export { randomUUID as _generateWaiterId };
