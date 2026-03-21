import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllVoiceTurns, hasActiveVoiceTurn } from "../voice-turn-state.js";
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
  it("starts a voice turn", () => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
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
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-2",
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already active") }),
    );
  });
});

describe("chat.turn.append", () => {
  it("appends text to an active turn", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.append"], {
      sessionKey: "main",
      turnId: "turn-1",
      text: "hello",
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });

  it("rejects append with no active turn", () => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.append"], {
      sessionKey: "main",
      turnId: "turn-1",
      text: "hello",
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("no active voice turn") }),
    );
  });
});

describe("chat.turn.update", () => {
  it("updates speech state", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.update"], {
      sessionKey: "main",
      turnId: "turn-1",
      kind: "speech_start",
      ts: Date.now(),
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });

  it("rejects invalid kind", () => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.update"], {
      sessionKey: "main",
      turnId: "turn-1",
      kind: "invalid",
      ts: Date.now(),
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: expect.any(String) }),
    );
  });
});

describe("chat.turn.commit", () => {
  it("commits and returns accumulated text", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    invokeHandler(chatVoiceTurnHandlers["chat.turn.append"], {
      sessionKey: "main",
      turnId: "turn-1",
      text: "hello ",
    });
    invokeHandler(chatVoiceTurnHandlers["chat.turn.append"], {
      sessionKey: "main",
      turnId: "turn-1",
      text: "world",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.commit"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      submitted: true,
      text: "hello world",
    });
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("commits with finalText overriding fragments", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    invokeHandler(chatVoiceTurnHandlers["chat.turn.append"], {
      sessionKey: "main",
      turnId: "turn-1",
      text: "partial",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.commit"], {
      sessionKey: "main",
      turnId: "turn-1",
      finalText: "final text",
    });
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      submitted: true,
      text: "final text",
    });
  });

  it("commits empty turn with submitted: false", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.commit"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      submitted: false,
    });
  });
});

describe("chat.turn.cancel", () => {
  it("cancels an active turn", () => {
    invokeHandler(chatVoiceTurnHandlers["chat.turn.start"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.cancel"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    expect(respond).toHaveBeenCalledWith(true, {
      ok: true,
      turnId: "turn-1",
      cancelled: true,
    });
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("responds OK even when no active turn (defensive cancel)", () => {
    const { respond } = invokeHandler(chatVoiceTurnHandlers["chat.turn.cancel"], {
      sessionKey: "main",
      turnId: "turn-1",
    });
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }));
  });
});
