# Workflow Events

OpenClaw gateway v1 ships an optional workflow event subscription model for
orchestration. It is **fully backward-compatible**: clients that do not call
`workflow.subscribe` receive no new events and existing behavior is unchanged.

---

## Overview

A process-global in-memory broker (`src/infra/workflow-events.ts`) emits a
stable `WorkflowEvent` envelope whenever key orchestration lifecycle changes
occur. The gateway exposes `workflow.subscribe` / `workflow.unsubscribe`
methods so WebSocket clients can opt in. Events are delivered as
`workflow.event` server frames to subscribed connections only.

### Event kinds

| Kind                 | When emitted                                             |
| -------------------- | -------------------------------------------------------- |
| `run.started`        | An agent run begins (`lifecycle` phase=start)            |
| `run.completed`      | A run ends successfully (`lifecycle` phase=end)          |
| `run.failed`         | A run ends with error (`lifecycle` phase=error)          |
| `subagent.spawned`   | A subagent is registered (before it starts running)      |
| `subagent.completed` | A subagent finishes with ok/killed/reset/deleted outcome |
| `subagent.failed`    | A subagent finishes with error/timeout outcome           |

### WorkflowEvent envelope

```ts
type WorkflowEvent = {
  id: string; // UUID, stable identifier for this event
  cursor: number; // Monotonically increasing integer (global, per gateway process)
  kind: WorkflowEventKind;
  ts: number; // Unix ms timestamp
  sessionKey?: string; // Session that owns/triggered this event
  runId?: string; // Agent run ID
  parentSessionKey?: string; // For subagent.* events: the spawning session
  childSessionKey?: string; // For subagent.* events: the spawned session
  data: Record<string, unknown>; // Kind-specific fields
};
```

---

## Gateway API

### `workflow.subscribe`

Register (or replace) a workflow event subscription for this connection.

**Request:**

```json
{
  "type": "request",
  "method": "workflow.subscribe",
  "id": "req-1",
  "params": {
    "afterCursor": 0,
    "kinds": ["subagent.spawned", "subagent.completed", "subagent.failed"],
    "sessionKey": "agent:my-agent"
  }
}
```

| Field         | Type                  | Description                                                                                               |
| ------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `afterCursor` | `number` (optional)   | Replay buffered events emitted after this cursor. Pass `0` (or omit) to skip replay.                      |
| `kinds`       | `string[]` (optional) | Only deliver events matching these kinds. Omit to receive all kinds.                                      |
| `sessionKey`  | `string` (optional)   | Only deliver events associated with this session (parentSessionKey / childSessionKey / sessionKey match). |

**Response:**

```json
{
  "type": "response",
  "id": "req-1",
  "result": {
    "subscribed": true,
    "bufferHead": 42,
    "oldestCursor": 1,
    "replayed": [...]
  }
}
```

| Field          | Description                                                                               |
| -------------- | ----------------------------------------------------------------------------------------- |
| `subscribed`   | `true` on success                                                                         |
| `bufferHead`   | Cursor of the most recent event in the replay buffer                                      |
| `oldestCursor` | Oldest cursor in the buffer; if `afterCursor` < `oldestCursor`, events were evicted (gap) |
| `replayed`     | Array of `WorkflowEvent` objects emitted after `afterCursor`                              |

### `workflow.unsubscribe`

Remove the workflow subscription for this connection.

**Request:**

```json
{
  "type": "request",
  "method": "workflow.unsubscribe",
  "id": "req-2",
  "params": {}
}
```

### `workflow.event` (server event)

Delivered to subscribed connections only when a matching event is emitted.

```json
{
  "type": "event",
  "event": "workflow.event",
  "payload": {
    "id": "e1a2b3...",
    "cursor": 7,
    "kind": "subagent.completed",
    "ts": 1711234567890,
    "sessionKey": "agent:orchestrator",
    "parentSessionKey": "agent:orchestrator",
    "childSessionKey": "agent:sub-task-1",
    "runId": "run-abc123",
    "data": { "outcome": "ok", "reason": "subagent-complete" }
  }
}
```

---

## Replay and gap detection

The broker maintains an in-memory ring buffer of the last 500 events. On
reconnect, clients should:

1. Call `workflow.subscribe` with `afterCursor` set to the last cursor they
   saw before disconnect.
2. Inspect the response:
   - If `afterCursor >= oldestCursor`: replay is complete, no gap.
   - If `afterCursor < oldestCursor`: events were evicted. Treat this as a
     gap and do a full refresh (e.g., re-fetch session state via
     `sessions.list`).

---

## Talkyn / client integration guide

### Feature detection

Before subscribing, detect support by checking the `methods` array in the
`hello-ok` response (or the gateway's method list):

```ts
function supportsWorkflowEvents(methods: string[]): boolean {
  return methods.includes("workflow.subscribe");
}
```

### Recommended integration

```ts
// On connect, after hello-ok received:
if (supportsWorkflowEvents(helloOk.methods)) {
  ws.send(
    JSON.stringify({
      type: "request",
      method: "workflow.subscribe",
      id: "wf-sub-1",
      params: {
        afterCursor: lastSeenCursor ?? 0,
        kinds: ["subagent.spawned", "subagent.completed", "subagent.failed"],
      },
    }),
  );
}

// Handle incoming events:
ws.on("message", (raw) => {
  const frame = JSON.parse(raw);
  if (frame.type === "event" && frame.event === "workflow.event") {
    handleWorkflowEvent(frame.payload);
    lastSeenCursor = frame.payload.cursor;
  }
  // Existing session.message / sessions.changed handlers are unchanged.
});
```

### Graceful fallback

When the gateway does not support workflow events (native/upstream OpenClaw
or an older fork version), `workflow.subscribe` will return a
`METHOD_NOT_FOUND` error or the method will be absent from `methods`.

In this case, fall back to the existing polling strategy:

- Listen for `sessions.changed` events to detect session state changes.
- Listen for `session.message` events for individual message delivery.
- Poll session state via `sessions.list` as needed.

This fallback ensures Talkyn continues to work against upstream/native
OpenClaw without fork-only dependencies.

```ts
ws.on("message", (raw) => {
  const frame = JSON.parse(raw);
  if (frame.type === "response" && frame.id === "wf-sub-1") {
    if (!frame.result?.subscribed) {
      // Workflow events not supported; activate fallback polling.
      activateLegacySessionPolling();
    }
  }
});
```

---

## Session-level wait/wake (`workflow_wait` tool)

Orchestrator agents can use the `workflow_wait` tool to pause their current
turn until a matching workflow event is emitted. This is built on the same
broker and respects self-wake guards.

**Tool name:** `workflow_wait`

**Parameters:**

| Param         | Type                                 | Description                        |
| ------------- | ------------------------------------ | ---------------------------------- |
| `kinds`       | `string[]` (optional)                | Event kinds to wait for            |
| `session_key` | `string` (optional)                  | Only match events for this session |
| `timeout_ms`  | `number` (optional, default 120 000) | Timeout in ms                      |

**Example:**

```
workflow_wait({"kinds": ["subagent.completed"], "session_key": "agent:sub-task-1", "timeout_ms": 60000})
```

Returns:

- `{ status: "matched", event: WorkflowEvent }` on success
- `{ status: "timeout", error: "..." }` on timeout

The tool does not self-wake: events emitted by the same orchestrator session
during the same turn are ignored as waiter matches.

---

## Architecture

```
onAgentEvent (infra/agent-events.ts)
  └─ workflow-event-bridge.ts          maps lifecycle events → run.*
       └─ emitWorkflowEvent()
            ├─ replay buffer (ring, 500 events)
            ├─ per-connection subscriber callbacks
            │    └─ broadcastToConnIds("workflow.event", ...)
            └─ one-shot waiters (workflow_wait tool)

subagent-registry.ts
  ├─ registerSubagentRun → emitSubagentWorkflowEvent("subagent.spawned")
  └─ emitSubagentEndedHookForRun → emitSubagentWorkflowEvent("subagent.completed"|"subagent.failed")
```

---

## v1 limitations and follow-ups

- Replay buffer is in-memory only; events are lost on gateway restart. Clients
  should always use gap detection and fall back to `sessions.list` on reconnect.
- The broker is process-global (singleton); multi-process gateway deployments
  would need a shared bus (out of scope for v1).
- The `workflow_wait` tool does not persist across session restarts; if the
  gateway restarts while a tool is waiting, the session will receive a timeout
  error on next wake.
- Filter matching on `sessionKey` is a simple equality check; glob/pattern
  matching is not supported in v1.
