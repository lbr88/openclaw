import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandLane } from "../process/lanes.js";

const queueMocks = vi.hoisted(() => ({
  setCommandLaneConcurrency: vi.fn(),
}));

vi.mock("../process/command-queue.js", () => ({
  setCommandLaneConcurrency: queueMocks.setCommandLaneConcurrency,
}));

describe("applyGatewayLaneConcurrency", () => {
  beforeEach(() => {
    vi.resetModules();
    queueMocks.setCommandLaneConcurrency.mockReset();
  });

  it("applies default concurrency including the nested lane", async () => {
    const { applyGatewayLaneConcurrency } = await import("./server-lanes.js");

    applyGatewayLaneConcurrency({} as never);

    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(1, CommandLane.Cron, 1);
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(2, CommandLane.Main, 4);
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(
      3,
      CommandLane.Subagent,
      8,
    );
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(4, CommandLane.Nested, 8);
  });

  it("sizes the nested lane to the larger of agent and subagent concurrency", async () => {
    const { applyGatewayLaneConcurrency } = await import("./server-lanes.js");

    applyGatewayLaneConcurrency({
      cron: { maxConcurrentRuns: 2 },
      agents: {
        defaults: {
          maxConcurrent: 6,
          subagents: { maxConcurrent: 3 },
        },
      },
    } as never);

    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(1, CommandLane.Cron, 2);
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(2, CommandLane.Main, 6);
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(
      3,
      CommandLane.Subagent,
      3,
    );
    expect(queueMocks.setCommandLaneConcurrency).toHaveBeenNthCalledWith(4, CommandLane.Nested, 6);
  });
});
