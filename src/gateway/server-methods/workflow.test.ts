import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  emitWorkflowEvent,
  resetWorkflowEventsForTest,
  getWorkflowBrokerSnapshot,
  replayWorkflowEvents,
  subscribeWorkflowEvents,
  unsubscribeWorkflowEvents,
  type WorkflowEventFilter,
} from "../../infra/workflow-events.js";
import type { GatewayRequestHandlers } from "./types.js";
import { workflowHandlers } from "./workflow.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal fake context wired to the real broker
// ---------------------------------------------------------------------------

function makeContext() {
  return {
    subscribeWorkflowEvents: vi.fn((connId: string, filter: WorkflowEventFilter) => {
      subscribeWorkflowEvents(connId, filter, () => {});
    }),
    unsubscribeWorkflowEvents: vi.fn((connId: string) => {
      unsubscribeWorkflowEvents(connId);
    }),
    replayWorkflowEvents: vi.fn((afterCursor: number, filter?: WorkflowEventFilter) =>
      replayWorkflowEvents(afterCursor, filter),
    ),
  };
}

type FakeContext = ReturnType<typeof makeContext>;

function invoke(
  method: keyof GatewayRequestHandlers,
  params: Record<string, unknown>,
  context: FakeContext,
  connId = "conn-1",
) {
  const respond = vi.fn();
  void workflowHandlers[method]?.({
    req: {} as never,
    params,
    respond: respond as never,
    context: context as never,
    client: { connId, connect: { role: "operator", scopes: ["*"] } } as never,
    isWebchatConnect: () => false,
  });
  return respond;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetWorkflowEventsForTest();
});
afterEach(() => {
  resetWorkflowEventsForTest();
});

describe("workflow.subscribe", () => {
  it("responds with subscribed:true", () => {
    const ctx = makeContext();
    const respond = invoke("workflow.subscribe", {}, ctx);
    const [ok, result] = respond.mock.calls[0] as [boolean, Record<string, unknown>];
    expect(ok).toBe(true);
    expect(result.subscribed).toBe(true);
  });

  it("calls subscribeWorkflowEvents on the context", () => {
    const ctx = makeContext();
    invoke("workflow.subscribe", { kinds: ["run.started"] }, ctx);
    expect(ctx.subscribeWorkflowEvents).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ kinds: ["run.started"] }),
    );
  });

  it("includes replay result in response", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });

    const ctx = makeContext();
    const respond = invoke("workflow.subscribe", { afterCursor: 0 }, ctx);
    const [ok, result] = respond.mock.calls[0] as [
      boolean,
      { replayed: unknown[]; bufferHead: number; oldestCursor: number },
    ];
    expect(ok).toBe(true);
    expect(result.replayed).toHaveLength(2);
    expect(result.bufferHead).toBe(2);
  });

  it("replays only events matching kinds filter", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "subagent.spawned", ts: 2, data: {} });

    const ctx = makeContext();
    const respond = invoke("workflow.subscribe", { afterCursor: 0, kinds: ["run.started"] }, ctx);
    const [, result] = respond.mock.calls[0] as [boolean, { replayed: unknown[] }];
    expect(result.replayed).toHaveLength(1);
  });

  it("returns invalid request error for bad params (kinds not an array)", () => {
    const ctx = makeContext();
    const respond = invoke("workflow.subscribe", { kinds: "not-an-array" } as never, ctx);
    const [ok] = respond.mock.calls[0] as [boolean];
    expect(ok).toBe(false);
  });
});

describe("workflow.unsubscribe", () => {
  it("responds with unsubscribed:true", () => {
    const ctx = makeContext();
    const respond = invoke("workflow.unsubscribe", {}, ctx);
    const [ok, result] = respond.mock.calls[0] as [boolean, Record<string, unknown>];
    expect(ok).toBe(true);
    expect(result.unsubscribed).toBe(true);
  });

  it("calls unsubscribeWorkflowEvents on the context", () => {
    const ctx = makeContext();
    invoke("workflow.unsubscribe", {}, ctx);
    expect(ctx.unsubscribeWorkflowEvents).toHaveBeenCalledWith("conn-1");
  });
});

describe("broker integration through subscribe/unsubscribe", () => {
  it("subscription is reflected in broker state", () => {
    subscribeWorkflowEvents("c1", {}, () => {});
    subscribeWorkflowEvents("c2", {}, () => {});
    expect(getWorkflowBrokerSnapshot().subscriberCount).toBe(2);

    unsubscribeWorkflowEvents("c1");
    expect(getWorkflowBrokerSnapshot().subscriberCount).toBe(1);
  });

  it("replay returns correct gap detection fields", () => {
    emitWorkflowEvent({ kind: "run.started", ts: 1, data: {} });
    emitWorkflowEvent({ kind: "run.completed", ts: 2, data: {} });

    const result = replayWorkflowEvents(0);
    expect(result.bufferHead).toBe(2);
    expect(result.oldestCursor).toBe(1);
    // afterCursor=0 < oldestCursor=1 means no gap (we got everything)
    // afterCursor=0 returns events with cursor > 0, so both events included.
    expect(result.events).toHaveLength(2);
  });
});
