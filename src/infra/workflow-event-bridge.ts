/**
 * Workflow event bridge: maps existing agent-event lifecycle signals into
 * stable WorkflowEvent envelopes via the broker.
 *
 * Call `startWorkflowEventBridge()` once at gateway startup. The returned
 * stop function should be called on gateway shutdown.
 *
 * Mapping:
 *   AgentEvent(stream="lifecycle", data.phase="start")  → run.started
 *   AgentEvent(stream="lifecycle", data.phase="end")    → run.completed
 *   AgentEvent(stream="lifecycle", data.phase="error")  → run.failed
 *
 * Subagent events (subagent.spawned / subagent.completed / subagent.failed)
 * are emitted directly by the subagent registry via `emitSubagentWorkflowEvent`
 * so this bridge does not need to duplicate that logic.
 */

import { onAgentEvent } from "./agent-events.js";
import { emitWorkflowEvent, type WorkflowEventKind } from "./workflow-events.js";

let bridgeStarted = false;
let stopFn: (() => void) | null = null;

/**
 * Start the bridge. Idempotent: calling more than once is a no-op (the first
 * registration wins and the returned stop function is still valid).
 */
export function startWorkflowEventBridge(): () => void {
  if (bridgeStarted) {
    return stopFn ?? (() => {});
  }
  bridgeStarted = true;

  const unsub = onAgentEvent((agentEvt) => {
    if (agentEvt.stream !== "lifecycle") {
      return;
    }

    const phase = agentEvt.data?.phase;
    let kind: WorkflowEventKind | null = null;
    if (phase === "start") {
      kind = "run.started";
    } else if (phase === "end") {
      kind = "run.completed";
    } else if (phase === "error") {
      kind = "run.failed";
    }
    if (!kind) {
      return;
    }

    emitWorkflowEvent({
      kind,
      ts: agentEvt.ts,
      sessionKey: agentEvt.sessionKey,
      runId: agentEvt.runId,
      data: {
        seq: agentEvt.seq,
        ...agentEvt.data,
      },
    });
  });

  stopFn = () => {
    unsub();
    bridgeStarted = false;
    stopFn = null;
  };
  return stopFn;
}

/**
 * Emit a subagent lifecycle workflow event. Called by the subagent registry
 * on spawn and settle so the broker can track subagent.* events.
 *
 * This is a thin wrapper so registry code does not need to import the full
 * broker module directly — only this entry point.
 */
export function emitSubagentWorkflowEvent(params: {
  kind: "subagent.spawned" | "subagent.completed" | "subagent.failed";
  runId: string;
  parentSessionKey: string;
  childSessionKey: string;
  data?: Record<string, unknown>;
}): void {
  emitWorkflowEvent({
    kind: params.kind,
    ts: Date.now(),
    runId: params.runId,
    parentSessionKey: params.parentSessionKey,
    childSessionKey: params.childSessionKey,
    sessionKey: params.parentSessionKey,
    data: params.data ?? {},
  });
}

/** Reset for tests. */
export function resetWorkflowEventBridgeForTest(): void {
  if (stopFn) {
    stopFn();
  }
  bridgeStarted = false;
  stopFn = null;
}
