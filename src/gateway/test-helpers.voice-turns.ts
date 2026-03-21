import type {
  ChatTurnAppendParams,
  ChatTurnCancelParams,
  ChatTurnCommitParams,
  ChatTurnStartParams,
  ChatTurnUpdateParams,
} from "./protocol/schema/voice-turns.js";

const DEFAULT_SESSION_KEY = "main";
const DEFAULT_TURN_ID = "turn-1";
const DEFAULT_TS = 1_777_777_777_000;

export const voiceTurnFrontendContract = {
  start(overrides: Partial<ChatTurnStartParams> = {}): ChatTurnStartParams {
    return {
      sessionKey: DEFAULT_SESSION_KEY,
      turnId: DEFAULT_TURN_ID,
      ...overrides,
    };
  },

  append(overrides: Partial<ChatTurnAppendParams> = {}): ChatTurnAppendParams {
    return {
      sessionKey: DEFAULT_SESSION_KEY,
      turnId: DEFAULT_TURN_ID,
      text: "hello",
      segmentIndex: 0,
      ...overrides,
    };
  },

  update(overrides: Partial<ChatTurnUpdateParams> = {}): ChatTurnUpdateParams {
    return {
      sessionKey: DEFAULT_SESSION_KEY,
      turnId: DEFAULT_TURN_ID,
      kind: "speech_start",
      ts: DEFAULT_TS,
      ...overrides,
    };
  },

  commit(overrides: Partial<ChatTurnCommitParams> = {}): ChatTurnCommitParams {
    return {
      sessionKey: DEFAULT_SESSION_KEY,
      turnId: DEFAULT_TURN_ID,
      fullText: "hello world",
      segmentCount: 2,
      commitReason: "uncertain+complete",
      ...overrides,
    };
  },

  cancel(overrides: Partial<ChatTurnCancelParams> = {}): ChatTurnCancelParams {
    return {
      sessionKey: DEFAULT_SESSION_KEY,
      turnId: DEFAULT_TURN_ID,
      reason: "user_cancelled",
      ...overrides,
    };
  },
} as const;

export function withUnexpectedProperty<T extends Record<string, unknown>>(
  params: T,
  key = "unexpected",
  value: unknown = true,
): T & Record<string, unknown> {
  return {
    ...params,
    [key]: value,
  };
}
