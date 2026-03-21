import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendVoiceTurnText,
  cancelVoiceTurn,
  clearAllVoiceTurns,
  clearVoiceTurn,
  clearVoiceTurnsByConnId,
  commitVoiceTurn,
  getActiveVoiceTurns,
  getVoiceTurn,
  hasActiveVoiceTurn,
  startVoiceTurn,
  updateVoiceTurnSpeech,
  VOICE_TURN_FAILSAFE_TIMEOUT_MS,
} from "./voice-turn-state.js";

const defaultOnTimeout = vi.fn();

afterEach(() => {
  clearAllVoiceTurns();
  defaultOnTimeout.mockReset();
  vi.restoreAllMocks();
});

describe("voice turn state", () => {
  it("starts a voice turn and tracks state", () => {
    const result = startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.turnId).toBe("turn-1");
    expect(result.state.sessionKey).toBe("main");
    expect(result.state.connId).toBe("conn-abc");
    expect(result.state.fragments).toEqual([]);
    expect(result.state.segments.size).toBe(0);
    expect(result.state.speaking).toBe(false);
    expect(hasActiveVoiceTurn("main")).toBe(true);
    expect(getVoiceTurn("main")?.turnId).toBe("turn-1");
  });

  it("rejects a second turn on the same session", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const result = startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-2",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("already active");
  });

  it("allows turns on different sessions", () => {
    const r1 = startVoiceTurn({
      sessionKey: "session-a",
      turnId: "turn-a",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const r2 = startVoiceTurn({
      sessionKey: "session-b",
      turnId: "turn-b",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(getActiveVoiceTurns().size).toBe(2);
  });

  it("stores fragments ordered by segmentIndex", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "world", 1);
    appendVoiceTurnText("main", "turn-1", "hello", 0);
    expect(getVoiceTurn("main")?.fragments).toEqual(["hello", "world"]);
  });

  it("replaces repeated segment indexes instead of duplicating them", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "hello", 0);
    appendVoiceTurnText("main", "turn-1", "wurld", 1);
    appendVoiceTurnText("main", "turn-1", "world", 1);
    expect(getVoiceTurn("main")?.fragments).toEqual(["hello", "world"]);
  });

  it("assigns implicit segment indexes when callers omit segmentIndex", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "hello");
    appendVoiceTurnText("main", "turn-1", "world");
    expect(getVoiceTurn("main")?.fragments).toEqual(["hello", "world"]);
  });

  it("rejects append with wrong turnId", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const result = appendVoiceTurnText("main", "wrong-id", "text", 0);
    expect(result.ok).toBe(false);
  });

  it("rejects append when no turn is active", () => {
    const result = appendVoiceTurnText("main", "turn-1", "text", 0);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid segmentIndex", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const result = appendVoiceTurnText("main", "turn-1", "text", -1);
    expect(result).toEqual({ ok: false, reason: "invalid segmentIndex" });
  });

  it("updates speech state", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    updateVoiceTurnSpeech("main", "turn-1", "speech_start");
    expect(getVoiceTurn("main")?.speaking).toBe(true);
    updateVoiceTurnSpeech("main", "turn-1", "speech_end");
    expect(getVoiceTurn("main")?.speaking).toBe(false);
  });

  it("commits a turn using deterministic spacing fallback", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "hello", 0);
    appendVoiceTurnText("main", "turn-1", "world", 1);
    const result = commitVoiceTurn("main", "turn-1");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.text).toBe("hello world");
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("commits fallback text in segment order after out-of-order appends", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "there", 2);
    appendVoiceTurnText("main", "turn-1", "hello", 0);
    appendVoiceTurnText("main", "turn-1", "wurld", 1);
    appendVoiceTurnText("main", "turn-1", "world", 1);
    const result = commitVoiceTurn("main", "turn-1");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.text).toBe("hello world there");
  });

  it("normalizes inconsistent fragment spacing in fallback commits", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "  hello   ", 0);
    appendVoiceTurnText("main", "turn-1", "\nworld\t", 1);
    const result = commitVoiceTurn("main", "turn-1");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.text).toBe("hello world");
  });

  it("uses explicit committed text instead of fragment fallback", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "partial", 0);
    const result = commitVoiceTurn("main", "turn-1", "final transcript");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.text).toBe("final transcript");
  });

  it("treats explicit empty committed text as an empty commit", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    appendVoiceTurnText("main", "turn-1", "stale fragment", 0);
    const result = commitVoiceTurn("main", "turn-1", "   ");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.text).toBe("");
  });

  it("cancels a turn and clears state", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const result = cancelVoiceTurn("main", "turn-1");
    expect(result.ok).toBe(true);
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("clearVoiceTurn clears unconditionally", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const cleared = clearVoiceTurn("main");
    expect(cleared).toBe(true);
    expect(hasActiveVoiceTurn("main")).toBe(false);
  });

  it("clearVoiceTurn with turnId mismatch does not clear", () => {
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout: defaultOnTimeout,
    });
    const cleared = clearVoiceTurn("main", "wrong-id");
    expect(cleared).toBe(false);
    expect(hasActiveVoiceTurn("main")).toBe(true);
  });

  it("clearVoiceTurnsByConnId clears all turns for a connection", () => {
    startVoiceTurn({
      sessionKey: "session-a",
      turnId: "turn-a",
      connId: "conn-1",
      onTimeout: defaultOnTimeout,
    });
    startVoiceTurn({
      sessionKey: "session-b",
      turnId: "turn-b",
      connId: "conn-1",
      onTimeout: defaultOnTimeout,
    });
    startVoiceTurn({
      sessionKey: "session-c",
      turnId: "turn-c",
      connId: "conn-2",
      onTimeout: defaultOnTimeout,
    });
    const cleared = clearVoiceTurnsByConnId("conn-1");
    expect(cleared).toEqual(expect.arrayContaining(["session-a", "session-b"]));
    expect(cleared).toHaveLength(2);
    expect(hasActiveVoiceTurn("session-a")).toBe(false);
    expect(hasActiveVoiceTurn("session-b")).toBe(false);
    expect(hasActiveVoiceTurn("session-c")).toBe(true);
  });

  it("failsafe timeout fires and clears the turn", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout,
      timeoutMs: 100,
    });
    expect(hasActiveVoiceTurn("main")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout.mock.calls[0][0].turnId).toBe("turn-1");
    expect(hasActiveVoiceTurn("main")).toBe(false);
    vi.useRealTimers();
  });

  it("commit clears failsafe timer (no timeout fire after commit)", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout,
      timeoutMs: 100,
    });
    commitVoiceTurn("main", "turn-1", "done");
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancel clears failsafe timer", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startVoiceTurn({
      sessionKey: "main",
      turnId: "turn-1",
      connId: "conn-abc",
      onTimeout,
      timeoutMs: 100,
    });
    cancelVoiceTurn("main", "turn-1");
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("VOICE_TURN_FAILSAFE_TIMEOUT_MS is 60 seconds", () => {
    expect(VOICE_TURN_FAILSAFE_TIMEOUT_MS).toBe(60_000);
  });
});
