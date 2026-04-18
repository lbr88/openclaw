import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const mockStore: Record<string, Record<string, unknown>> = {};
const mocks = vi.hoisted(() => ({
  resolveMessageChannelSelection: vi.fn(async () => {
    throw new Error("Channel is required (no configured channels detected).");
  }),
  resolveOutboundTarget: vi.fn(({ channel, to }: { channel: string; to?: string }) => ({
    ok: true as const,
    to: to?.trim() || channel,
  })),
  maybeResolveIdLikeTarget: vi.fn(async () => null),
}));

type DeliveryTargetModule = typeof import("./isolated-agent/delivery-target.js");
let resolveDeliveryTarget: DeliveryTargetModule["resolveDeliveryTarget"];

beforeAll(async () => {
  vi.doMock("../config/sessions/main-session.js", () => ({
    resolveAgentMainSessionKey: vi.fn(
      ({ agentId }: { agentId: string }) => `agent:${agentId}:main`,
    ),
  }));
  vi.doMock("../config/sessions/paths.js", () => ({
    resolveStorePath: vi.fn((_store: unknown, _opts: unknown) => "/mock/store.json"),
  }));
  vi.doMock("../config/sessions/store-load.js", () => ({
    loadSessionStore: vi.fn((storePath: string) => mockStore[storePath] ?? {}),
  }));
  vi.doMock("../infra/outbound/channel-selection.runtime.js", () => ({
    resolveMessageChannelSelection: mocks.resolveMessageChannelSelection,
  }));
  vi.doMock("../infra/outbound/targets.runtime.js", () => ({
    resolveOutboundTarget: mocks.resolveOutboundTarget,
  }));
  vi.doMock("../infra/outbound/target-id-resolution.js", () => ({
    maybeResolveIdLikeTarget: mocks.maybeResolveIdLikeTarget,
  }));
  vi.doMock("./isolated-agent/delivery-target.runtime.js", () => ({
    getLoadedChannelPluginForRead: vi.fn(() => undefined),
    mapAllowFromEntries: vi.fn((entries: string[]) => entries),
    readChannelAllowFromStoreEntriesSync: vi.fn(() => []),
    resolveFirstBoundAccountId: vi.fn(() => undefined),
  }));

  ({ resolveDeliveryTarget } = await import("./isolated-agent/delivery-target.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key];
  }
});

describe("resolveDeliveryTarget webchat fallback", () => {
  const cfg: OpenClawConfig = {} as OpenClawConfig;

  it("uses the main session webchat route when channel=last", async () => {
    mockStore["/mock/store.json"] = {
      "agent:main:main": {
        sessionId: "sess-webchat-main",
        updatedAt: 1,
        deliveryContext: { channel: "webchat" },
        lastChannel: "webchat",
      },
    };

    const result = await resolveDeliveryTarget(cfg, "main", {
      channel: "last",
    });

    expect(mocks.resolveMessageChannelSelection).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful webchat delivery target resolution");
    }
    expect(result.channel).toBe("webchat");
    expect(result.to).toBe("webchat");
  });
});
