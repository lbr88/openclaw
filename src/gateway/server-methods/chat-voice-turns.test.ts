import { afterEach, describe, expect, it, vi } from "vitest";
import { voiceTurnFrontendContract, withUnexpectedProperty } from "../test-helpers.voice-turns.js";
import { clearAllVoiceTurns, getVoiceTurn, hasActiveVoiceTurn } from "../voice-turn-state.js";
import { chatVoiceTurnHandlers } from "./chat-voice-turns.js";
import type { GatewayRequestHandler } from "./types.js";

function createMockContext() {
  return {
    logGateway: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    broadcast: vi.fn(),
    nodeSendToSession: vi.fn(),
  };
}

function invokeHandler(
  handler: GatewayRequestHandler,
  params: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const respond = vi.fn();
  const context = createMockContext();
  void handler({
    params,
    respond,
    context: { ...context, ...overrides } as never,
    req: {} as never,
    client: { connId: "test-conn-1", connect: {} } as never,
    isWebchatConnect: () => false,
  });
  return { respond, context };
}

afterEach(() => {
  clearAllVoiceTurns();
  vi.restoreAllMocks();
});

describe("chat.turn.start", () => {
  it("starts a voice turn from the canonical frontend payload", () => {
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.start"],
      voiceTurnFrontendContract.start(),
    );
    expect(respond).toHaveBeenCalledWith(true, { ok: true, turnId: "turn-1" });
    expect(hasActiveVoiceTurn("main")).toBe(true);
  });

  it("rejects invalid params", () => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {});
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: expect.any(String) }),
    );
  });

  it("rejects a second turn on the same session", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.start"],
      voiceTurnFrontendContract.start({ turnId: "turn-2" }),
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already active") }),
    );
  });
});

describe("chat.turn.append", () => {
  it("appends text to an active turn using segmentIndex", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.append"],
      voiceTurnFrontendContract.append({ text: "hello", segmentIndex: 0 }),
    );
    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });

  it("rejects append with no active turn", () => {
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.append"],
      voiceTurnFrontendContract.append({ text: "hello", segmentIndex: 0 }),
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("no active voice turn") }),
    );
  });
});

describe("chat.turn.update", () => {
  it("updates speech state from the canonical frontend payload", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.update"],
      voiceTurnFrontendContract.update({ kind: "speech_start" }),
    );
    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });

  it("rejects invalid kind", () => {
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.update"],
      voiceTurnFrontendContract.update({ kind: "invalid" as never }),
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: expect.any(String) }),
    );
  });
});

describe("chat.turn.commit", () => {
  it("commits and returns the canonical frontend fullText", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    invokeHandler(
      chatVoiceTurnHandlers["chat.turn.append"],
      voiceTurnFrontendContract.append({ text: "hello", segmentIndex: 0 }),
    );
    invokeHandler(
      chatVoiceTurnHandlers["chat.turn.append"],
      voiceTurnFrontendContract.append({ text: "world", segmentIndex: 1 }),
    );
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.commit"],
      voiceTurnFrontendContract.commit({
        fullText: "hello world",
        segmentCount: 2,
        commitReason: "uncertain+complete",
      }),
    );
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      submitted: true,
      text: "hello world",
    });
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("commits empty turn with submitted: false when fullText is empty", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.commit"],
      voiceTurnFrontendContract.commit({
        fullText: "",
        segmentCount: 0,
        commitReason: "manual_empty",
      }),
    );
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      submitted: false,
    });
  });
});

describe("chat.turn.cancel", () => {
  it("cancels an active turn", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], voiceTurnFrontendContract.start());
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.cancel"],
      voiceTurnFrontendContract.cancel(),
    );
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      cancelled: true,
    });
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("responds OK even when no active turn (defensive cancel)", () => {
    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.cancel"],
      voiceTurnFrontendContract.cancel(),
    );
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }));
  });

  it("does not clear a newer active turn on stale cancel for an older turn", () => {
    invokeHandler(
      chatVoiceTurnHandlers["chat.turn.start"],
      voiceTurnFrontendContract.start({ turnId: "turn-1" }),
    );
    invokeHandler(
      chatVoiceTurnHandlers["chat.turn.commit"],
      voiceTurnFrontendContract.commit({
        turnId: "turn-1",
        fullText: "done",
        segmentCount: 1,
        commitReason: "manual_send",
      }),
    );
    invokeHandler(
      chatVoiceTurnHandlers["chat.turn.start"],
      voiceTurnFrontendContract.start({ turnId: "turn-2" }),
    );

    const { respond } = invokeHandler(
      chatVoiceTurnHandlers["chat.turn.cancel"],
      voiceTurnFrontendContract.cancel({ turnId: "turn-1" }),
    );

    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      cancelled: false,
    });
    expect(hasActiveVoiceTurn("main")).toBe(true);
    expect(getVoiceTurn("main")?.turnId).toBe("turn-2");
  });
});

describe("chat.turn.* handler contract guardrails", () => {
  const invalidCases = [
    {
      method: "chat.turn.start",
      params: withUnexpectedProperty(voiceTurnFrontendContract.start()),
    },
    {
      method: "chat.turn.append",
      params: withUnexpectedProperty(voiceTurnFrontendContract.append()),
    },
    {
      method: "chat.turn.update",
      params: withUnexpectedProperty(voiceTurnFrontendContract.update()),
    },
    {
      method: "chat.turn.commit",
      params: withUnexpectedProperty(voiceTurnFrontendContract.commit()),
    },
    {
      method: "chat.turn.cancel",
      params: withUnexpectedProperty(voiceTurnFrontendContract.cancel()),
    },
  ] as const;

  it.each(invalidCases)("rejects unexpected properties for $method", ({ method, params }) => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers[method], params);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("unexpected property") }),
    );
  });
});
