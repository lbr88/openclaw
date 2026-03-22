import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitAgentEvent, resetAgentEventsForTest } from "./agent-events.js";
import {
  startWorkflowEventBridge,
  resetWorkflowEventBridgeForTest,
  emitSubagentWorkflowEvent,
} from "./workflow-event-bridge.js";
import { onWorkflowEvent, resetWorkflowEventsForTest } from "./workflow-events.js";
import type { WorkflowEvent } from "./workflow-events.js";

beforeEach(() => {
  resetAgentEventsForTest();
  resetWorkflowEventsForTest();
  resetWorkflowEventBridgeForTest();
});
afterEach(() => {
  resetWorkflowEventBridgeForTest();
  resetAgentEventsForTest();
  resetWorkflowEventsForTest();
});

describe("startWorkflowEventBridge", () => {
  it("maps lifecycle phase=start to run.started", () => {
    startWorkflowEventBridge();
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "lifecycle", data: { phase: "start" } });
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("run.started");
    expect(received[0].runId).toBe("r1");
  });

  it("maps lifecycle phase=end to run.completed", () => {
    startWorkflowEventBridge();
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "lifecycle", data: { phase: "end" } });
    unsub();
    expect(received[0].kind).toBe("run.completed");
  });

  it("maps lifecycle phase=error to run.failed", () => {
    startWorkflowEventBridge();
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "lifecycle", data: { phase: "error" } });
    unsub();
    expect(received[0].kind).toBe("run.failed");
  });

  it("ignores non-lifecycle agent events", () => {
    startWorkflowEventBridge();
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "assistant", data: { text: "hello" } });
    emitAgentEvent({ runId: "r1", stream: "tool", data: { name: "bash" } });
    unsub();
    expect(received).toHaveLength(0);
  });

  it("stops mapping events after stop() is called", () => {
    const stop = startWorkflowEventBridge();
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "lifecycle", data: { phase: "start" } });
    stop();
    emitAgentEvent({ runId: "r2", stream: "lifecycle", data: { phase: "end" } });
    unsub();
    expect(received).toHaveLength(1);
  });

  it("is idempotent: calling start twice does not double-emit", () => {
    startWorkflowEventBridge();
    startWorkflowEventBridge(); // second call should be a no-op
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitAgentEvent({ runId: "r1", stream: "lifecycle", data: { phase: "start" } });
    unsub();
    expect(received).toHaveLength(1);
  });
});

describe("emitSubagentWorkflowEvent", () => {
  it("emits subagent.spawned with correct fields", () => {
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitSubagentWorkflowEvent({
      kind: "subagent.spawned",
      runId: "run-1",
      parentSessionKey: "agent:main",
      childSessionKey: "agent:sub",
      data: { label: "task" },
    });
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("subagent.spawned");
    expect(received[0].parentSessionKey).toBe("agent:main");
    expect(received[0].childSessionKey).toBe("agent:sub");
    expect(received[0].data.label).toBe("task");
  });

  it("emits subagent.completed and subagent.failed", () => {
    const received: WorkflowEvent[] = [];
    const unsub = onWorkflowEvent((e) => received.push(e));
    emitSubagentWorkflowEvent({
      kind: "subagent.completed",
      runId: "run-2",
      parentSessionKey: "agent:main",
      childSessionKey: "agent:sub",
    });
    emitSubagentWorkflowEvent({
      kind: "subagent.failed",
      runId: "run-3",
      parentSessionKey: "agent:main",
      childSessionKey: "agent:sub2",
      data: { outcome: "error" },
    });
    unsub();
    expect(received[0].kind).toBe("subagent.completed");
    expect(received[1].kind).toBe("subagent.failed");
    expect(received[1].data.outcome).toBe("error");
  });
});
