import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { enqueueCommandInLane, resetCommandQueueStateForTest } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  if (!resolve || !reject) {
    throw new Error("Expected deferred callbacks to be initialized");
  }
  return { promise, resolve, reject };
}

async function expectLanePeakConcurrency(lane: CommandLane, expectedPeak: number) {
  let activeRuns = 0;
  let peakActiveRuns = 0;
  const expectedRunsStarted = createDeferred<void>();
  const releaseRuns = createDeferred<void>();

  const run = async () => {
    activeRuns += 1;
    peakActiveRuns = Math.max(peakActiveRuns, activeRuns);
    if (peakActiveRuns >= expectedPeak) {
      expectedRunsStarted.resolve();
    }
    try {
      await releaseRuns.promise;
    } finally {
      activeRuns -= 1;
    }
  };

  const runs = Array.from({ length: expectedPeak }, () =>
    enqueueCommandInLane(lane, run, { warnAfterMs: 10_000 }),
  );
  const timeout = setTimeout(() => {
    expectedRunsStarted.reject(new Error(`timed out waiting for ${expectedPeak} ${lane} runs`));
  }, 250);

  try {
    await expectedRunsStarted.promise;
    expect(peakActiveRuns).toBe(expectedPeak);
  } finally {
    clearTimeout(timeout);
    releaseRuns.resolve();
    await Promise.all(runs);
  }
}

describe("applyGatewayLaneConcurrency", () => {
  afterEach(() => {
    resetCommandQueueStateForTest();
  });

  it("applies cron maxConcurrentRuns to the cron-nested lane used by cron agent turns", async () => {
    applyGatewayLaneConcurrency({ cron: { maxConcurrentRuns: 2 } } as OpenClawConfig);

    await expectLanePeakConcurrency(CommandLane.CronNested, 2);
  });

  it("applies default concurrency to the shared nested lane", async () => {
    applyGatewayLaneConcurrency({ cron: { maxConcurrentRuns: 2 } } as OpenClawConfig);

    await expectLanePeakConcurrency(CommandLane.Nested, 8);
  });

  it("sizes the nested lane to the larger of agent and subagent concurrency", async () => {
    applyGatewayLaneConcurrency({
      agents: {
        defaults: {
          maxConcurrent: 6,
          subagents: { maxConcurrent: 3 },
        },
      },
    } as OpenClawConfig);

    await expectLanePeakConcurrency(CommandLane.Nested, 6);
  });
});
