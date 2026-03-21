/**
 * Per-session voice turn state management.
 *
 * Tracks an in-progress draft voice turn for each session key. While a turn
 * is active the followup queue drain is held so that the agent doesn't reply
 * to partial utterances.
 *
 * Refs: lbr88/talkyn-native#170
 */

/** How long (ms) a voice turn can stay open before the failsafe fires. */
export const VOICE_TURN_FAILSAFE_TIMEOUT_MS = 60_000;

export type VoiceTurnState = {
  /** Unique turn id supplied by the frontend. */
  turnId: string;
  /** Session key this turn belongs to. */
  sessionKey: string;
  /** Connection id of the owner (for abort on disconnect). */
  connId: string;
  /** Ordered transcript fragments resolved from `chat.turn.append`. */
  fragments: string[];
  /** Raw transcript fragments keyed by segment index (or implicit fallback index). */
  segments: Map<number, string>;
  /** Next implicit segment index for legacy/internal callers that omit it. */
  nextSegmentIndex: number;
  /** Whether the user is currently speaking. */
  speaking: boolean;
  /** Epoch ms when the turn was started. */
  startedAtMs: number;
  /** Failsafe timer handle – fires if the turn is never committed/cancelled. */
  failsafeTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Global registry of active voice turns keyed by session key.
 * Only one voice turn per session is allowed at a time.
 */
const VOICE_TURNS = new Map<string, VoiceTurnState>();

export function getVoiceTurn(sessionKey: string): VoiceTurnState | undefined {
  return VOICE_TURNS.get(sessionKey);
}

export function hasActiveVoiceTurn(sessionKey: string): boolean {
  return VOICE_TURNS.has(sessionKey);
}

export type VoiceTurnStartResult =
  | { ok: true; state: VoiceTurnState }
  | { ok: false; reason: string };

export function startVoiceTurn(params: {
  sessionKey: string;
  turnId: string;
  connId: string;
  onTimeout: (state: VoiceTurnState) => void;
  timeoutMs?: number;
}): VoiceTurnStartResult {
  const existing = VOICE_TURNS.get(params.sessionKey);
  if (existing) {
    return {
      ok: false,
      reason: `voice turn already active (turnId=${existing.turnId})`,
    };
  }

  const failsafeMs = params.timeoutMs ?? VOICE_TURN_FAILSAFE_TIMEOUT_MS;
  const state: VoiceTurnState = {
    turnId: params.turnId,
    sessionKey: params.sessionKey,
    connId: params.connId,
    fragments: [],
    segments: new Map(),
    nextSegmentIndex: 0,
    speaking: false,
    startedAtMs: Date.now(),
    failsafeTimer: null,
  };

  state.failsafeTimer = setTimeout(() => {
    // Failsafe: auto-cancel if the turn was never committed or cancelled.
    // This covers client crashes and network drops.
    const current = VOICE_TURNS.get(params.sessionKey);
    if (current && current.turnId === params.turnId) {
      params.onTimeout(current);
      clearVoiceTurn(params.sessionKey, params.turnId);
    }
  }, failsafeMs);
  state.failsafeTimer.unref?.();

  VOICE_TURNS.set(params.sessionKey, state);
  return { ok: true, state };
}

export function appendVoiceTurnText(
  sessionKey: string,
  turnId: string,
  text: string,
  segmentIndex?: number,
): { ok: boolean; reason?: string } {
  const state = VOICE_TURNS.get(sessionKey);
  if (!state) {
    return { ok: false, reason: "no active voice turn" };
  }
  if (state.turnId !== turnId) {
    return { ok: false, reason: "turnId mismatch" };
  }

  const resolvedSegmentIndex = resolveVoiceTurnSegmentIndex(state, segmentIndex);
  if (resolvedSegmentIndex === null) {
    return { ok: false, reason: "invalid segmentIndex" };
  }

  state.segments.set(resolvedSegmentIndex, text);
  state.fragments = getOrderedVoiceTurnFragments(state);
  return { ok: true };
}

export function updateVoiceTurnSpeech(
  sessionKey: string,
  turnId: string,
  kind: "speech_start" | "speech_end",
): { ok: boolean; reason?: string } {
  const state = VOICE_TURNS.get(sessionKey);
  if (!state) {
    return { ok: false, reason: "no active voice turn" };
  }
  if (state.turnId !== turnId) {
    return { ok: false, reason: "turnId mismatch" };
  }
  state.speaking = kind === "speech_start";
  return { ok: true };
}

export type VoiceTurnCommitResult =
  | { ok: true; text: string; state: VoiceTurnState }
  | { ok: false; reason: string };

export function commitVoiceTurn(
  sessionKey: string,
  turnId: string,
  committedText?: string,
): VoiceTurnCommitResult {
  const state = VOICE_TURNS.get(sessionKey);
  if (!state) {
    return { ok: false, reason: "no active voice turn" };
  }
  if (state.turnId !== turnId) {
    return { ok: false, reason: "turnId mismatch" };
  }

  const text =
    committedText === undefined ? assembleVoiceTurnText(state.fragments) : committedText.trim();

  clearVoiceTurnTimer(state);
  VOICE_TURNS.delete(sessionKey);
  return { ok: true, text, state };
}

export function cancelVoiceTurn(
  sessionKey: string,
  turnId: string,
): { ok: boolean; reason?: string } {
  const state = VOICE_TURNS.get(sessionKey);
  if (!state) {
    return { ok: false, reason: "no active voice turn" };
  }
  if (state.turnId !== turnId) {
    return { ok: false, reason: "turnId mismatch" };
  }
  clearVoiceTurnTimer(state);
  VOICE_TURNS.delete(sessionKey);
  return { ok: true };
}

/**
 * Clear voice turn unconditionally (e.g. from failsafe or disconnect cleanup).
 * Returns true if a turn was cleared.
 */
export function clearVoiceTurn(sessionKey: string, turnId?: string): boolean {
  const state = VOICE_TURNS.get(sessionKey);
  if (!state) {
    return false;
  }
  if (turnId && state.turnId !== turnId) {
    return false;
  }
  clearVoiceTurnTimer(state);
  VOICE_TURNS.delete(sessionKey);
  return true;
}

/**
 * Clear all voice turns owned by a specific connection (disconnect cleanup).
 * Returns the session keys that were cleared.
 */
export function clearVoiceTurnsByConnId(connId: string): string[] {
  const cleared: string[] = [];
  for (const [sessionKey, state] of VOICE_TURNS) {
    if (state.connId === connId) {
      clearVoiceTurnTimer(state);
      VOICE_TURNS.delete(sessionKey);
      cleared.push(sessionKey);
    }
  }
  return cleared;
}

/** Get a snapshot of active voice turns (for testing/debugging). */
export function getActiveVoiceTurns(): ReadonlyMap<string, VoiceTurnState> {
  return VOICE_TURNS;
}

/** Clear all voice turns (for testing). */
export function clearAllVoiceTurns(): void {
  for (const state of VOICE_TURNS.values()) {
    clearVoiceTurnTimer(state);
  }
  VOICE_TURNS.clear();
}

function resolveVoiceTurnSegmentIndex(state: VoiceTurnState, segmentIndex?: number): number | null {
  if (segmentIndex === undefined) {
    const nextSegmentIndex = state.nextSegmentIndex;
    state.nextSegmentIndex += 1;
    return nextSegmentIndex;
  }

  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return null;
  }

  state.nextSegmentIndex = Math.max(state.nextSegmentIndex, segmentIndex + 1);
  return segmentIndex;
}

function getOrderedVoiceTurnFragments(state: VoiceTurnState): string[] {
  return Array.from(state.segments.entries())
    .toSorted(([left], [right]) => left - right)
    .map(([, fragment]) => fragment);
}

function assembleVoiceTurnText(fragments: string[]): string {
  return fragments
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter((fragment) => fragment.length > 0)
    .join(" ");
}

function clearVoiceTurnTimer(state: VoiceTurnState): void {
  if (state.failsafeTimer) {
    clearTimeout(state.failsafeTimer);
    state.failsafeTimer = null;
  }
}
