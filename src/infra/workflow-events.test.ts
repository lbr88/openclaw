import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  emitWorkflowEvent,
  onWorkflowEvent,
  subscribeWorkflowEvents,
  unsubscribeWorkflowEvents,
  replayWorkflowEvents,
  waitForWorkflowEvent,
  clearWorkflowWaitersForSession,
  matchesWorkflowFilter,
  resetWorkflowEventsForTest,
  getWorkflowBrokerSnapshot,
  type WorkflowEvent,
} from "./workflow-events.js";

beforeEach(() => {
  resetWorkflowEventsForTest();
});
afterEach(() => {
  resetWorkflowEventsForTest();
});

// ---------------------------------------------------------------------------
// Emit + envelope
// ---------------------------------------------------------------------------

describe("emitWorkflowEvent", () => {
  it("assigns a cursor that increments with each emit", () => {
    const e1 = emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    const e2 = emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    expect(e1.cursor).toBe(1);
    expect(e2.cursor).toBe(2);
  });

  it("assigns a unique id to each event", () => {
    const e1 = emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    const e2 = emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    expect(e1.id).not.toBe(e2.id);
    expect(typeof e1.id).toBe("string");
  });

  it("includes all provided fields in the emitted event", () => {
    const evt = emitWorkflowEvent({
      kind: "subagent.spawned",
      ts: 1234,
      sessionKey: "agent:main",
      runId: "run-1",
      parentSessionKey: "agent:main",
      childSessionKey: "agent:sub",
      data: { label: "task-a" },
    });
    expect(evt.kind).toBe("subagent.spawned");
    expect(evt.sessionKey).toBe("agent:main");
    expect(evt.runId).toBe("run-1");
    expect(evt.childSessionKey).toBe("agent:sub");
    expect(evt.data.label).toBe("task-a");
  });
});

// ---------------------------------------------------------------------------
// Replay buffer
// ---------------------------------------------------------------------------

describe("replayWorkflowEvents", () => {
  it("returns empty results when buffer is empty", () => {
    const result = replayWorkflowEvents(0);
    expect(result.events).toHaveLength(0);
    expect(result.bufferHead).toBe(0);
    expect(result.oldestCursor).toBe(0);
  });

  it("replays all events when afterCursor=0", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    const result = replayWorkflowEvents(0);
    expect(result.events).toHaveLength(2);
  });

  it("replays only events after the given cursor", () => {
    const e1 = emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    const result = replayWorkflowEvents(e1.cursor);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("run.completed");
  });

  it("reports correct bufferHead and oldestCursor", () => {
    const e1 = emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    const e2 = emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    const result = replayWorkflowEvents(0);
    expect(result.bufferHead).toBe(e2.cursor);
    expect(result.oldestCursor).toBe(e1.cursor);
  });

  it("filters by kind during replay", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    emitWorkflowEvent({ kind: "subagent.spawned", ts: 3, data: {} });
    const result = replayWorkflowEvents(0, { kinds: ["run.started", "run.completed"] });
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => ["run.started", "run.completed"].includes(e.kind))).toBe(
      true,
    );
  });

  it("filters by sessionKey during replay", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, sessionKey: "agent:a", data: {} });
    emitWorkflowEvent({ kind: "run.started", ts: 2, sessionKey: "agent:b", data: {} });
    const result = replayWorkflowEvents(0, { sessionKey: "agent:a" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].sessionKey).toBe("agent:a");
  });
});

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

describe("matchesWorkflowFilter", () => {
  const mkEvt = (partial: Partial<WorkflowEvent>): WorkflowEvent => ({
    id: "id",
    cursor: 1,
    kind: "run.started",
    ts: 0,
    data: {},
    ...partial,
  });

  it("matches any event when filter is empty", () => {
    expect(matchesWorkflowFilter(mkEvt({ kind: "run.started" }), {})).toBe(true);
  });

  it("matches by kind", () => {
    const evt = mkEvt({ kind: "subagent.completed" });
    expect(matchesWorkflowFilter(evt, { kinds: ["subagent.completed"] })).toBe(true);
    expect(matchesWorkflowFilter(evt, { kinds: ["run.started"] })).toBe(false);
  });

  it("matches sessionKey against event sessionKey, parentSessionKey, and childSessionKey", () => {
    const evtA = mkEvt({ sessionKey: "agent:a" });
    const evtB = mkEvt({ parentSessionKey: "agent:a" });
    const evtC = mkEvt({ childSessionKey: "agent:a" });
    const evtD = mkEvt({ sessionKey: "agent:b" });

    expect(matchesWorkflowFilter(evtA, { sessionKey: "agent:a" })).toBe(true);
    expect(matchesWorkflowFilter(evtB, { sessionKey: "agent:a" })).toBe(true);
    expect(matchesWorkflowFilter(evtC, { sessionKey: "agent:a" })).toBe(true);
    expect(matchesWorkflowFilter(evtD, { sessionKey: "agent:a" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe("subscribeWorkflowEvents / unsubscribeWorkflowEvents", () => {
  it("delivers events to a subscriber", () => {
    const received: WorkflowEvent[] = [];
    subscribeWorkflowEvents("conn-1", {}, (evt) => received.push(evt));
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("run.started");
  });

  it("replaces existing subscription when called again with same connId", () => {
    const received1: WorkflowEvent[] = [];
    const received2: WorkflowEvent[] = [];
    subscribeWorkflowEvents("conn-1", {}, (evt) => received1.push(evt));
    subscribeWorkflowEvents("conn-1", { kinds: ["run.completed"] }, (evt) => received2.push(evt));
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    // First subscription replaced; second only accepts run.completed
    expect(received1).toHaveLength(0);
    expect(received2).toHaveLength(1);
    expect(received2[0].kind).toBe("run.completed");
  });

  it("stops delivery after unsubscribe", () => {
    const received: WorkflowEvent[] = [];
    subscribeWorkflowEvents("conn-1", {}, (evt) => received.push(evt));
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    unsubscribeWorkflowEvents("conn-1");
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    expect(received).toHaveLength(1);
  });

  it("does not deliver filtered events", () => {
    const received: WorkflowEvent[] = [];
    subscribeWorkflowEvents("conn-1", { kinds: ["subagent.completed"] }, (evt) =>
      received.push(evt),
    );
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    expect(received).toHaveLength(0);
    emitWorkflowEvent({ kind: "subagent.completed", ts: 2, data: {} });
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Raw listeners
// ---------------------------------------------------------------------------

describe("onWorkflowEvent", () => {
  it("receives all events unfiltered", () => {
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((evt) => received.push(evt));
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "subagent.failed", ts: 2, data: {} });
    expect(received).toHaveLength(2);
    unsub();
  });

  it("stops receiving after returned unsub is called", () => {
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((evt) => received.push(evt));
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    unsub();
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// One-shot waiters
// ---------------------------------------------------------------------------

describe("waitForWorkflowEvent", () => {
  it("resolves when a matching event is emitted", async () => {
    const promise = waitForWorkflowEvent({ kinds: ["run.completed"] }, 5000);
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} }); // no match
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: { ok: true } }); // match
    const evt = await promise;
    expect(evt.kind).toBe("run.completed");
    expect(evt.data.ok).toBe(true);
  });

  it("rejects on timeout", async () => {
    const promise = waitForWorkflowEvent({ kinds: ["run.completed"] }, 10);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("does not self-wake when callerSessionKey matches event sessionKey", async () => {
    // The waiter is registered with callerSessionKey = "agent:main".
    // An event from "agent:main" should NOT wake it.
    const promise = waitForWorkflowEvent({ kinds: ["subagent.spawned"] }, 200, "agent:main");
    // Self-emitted event from same session — should not wake the waiter.
    emitWorkflowEvent({
      kind: "subagent.spawned",
      ts: 1,
      sessionKey: "agent:main",
      parentSessionKey: "agent:main",
      childSessionKey: "agent:sub",
      data: {},
    });
    // Emit from a different session — should wake the waiter.
    emitWorkflowEvent({
      kind: "subagent.spawned",
      ts: 2,
      sessionKey: "agent:other",
      parentSessionKey: "agent:other",
      childSessionKey: "agent:sub-2",
      data: {},
    });
    const evt = await promise;
    expect(evt.sessionKey).toBe("agent:other");
  });

  it("clears waiter on session teardown", async () => {
    const p = waitForWorkflowEvent({}, 5000, "agent:orphan");
    clearWorkflowWaitersForSession("agent:orphan");
    expect(getWorkflowBrokerSnapshot().waiterCount).toBe(0);
    // The promise will be dangling (no reject/resolve after clear); that's OK
    // for cleanup — just ensure it doesn't leak.
    void p;
  });
});

// ---------------------------------------------------------------------------
// Broker state snapshot
// ---------------------------------------------------------------------------

describe("getWorkflowBrokerSnapshot", () => {
  it("tracks cursor and buffer size", () => {
    const s0 = getWorkflowBrokerSnapshot();
    expect(s0.cursor).toBe(0);
    expect(s0.bufferSize).toBe(0);

    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });

    const s2 = getWorkflowBrokerSnapshot();
    expect(s2.cursor).toBe(2);
    expect(s2.bufferSize).toBe(2);
  });
});
