import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

/**
 * Voice turn-taking protocol schemas.
 *
 * These schemas define the WebSocket methods the Talkyn frontend sends
 * to coordinate voice-based turns with the gateway. The gateway tracks
 * per-session draft state and holds the followup queue while a voice
 * turn is in progress.
 *
 * Refs: lbr88/talkyn-native#170
 */

export const ChatTurnStartParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type ChatTurnStartParams = {
  sessionKey: string;
  turnId: string;
};

export const ChatTurnAppendParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
    text: Type.String(),
  },
  { additionalProperties: false },
);

export type ChatTurnAppendParams = {
  sessionKey: string;
  turnId: string;
  text: string;
};

export const ChatTurnUpdateParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
    kind: Type.Union([Type.Literal("speech_start"), Type.Literal("speech_end")]),
    ts: Type.Number(),
  },
  { additionalProperties: false },
);

export type ChatTurnUpdateParams = {
  sessionKey: string;
  turnId: string;
  kind: "speech_start" | "speech_end";
  ts: number;
};

export const ChatTurnCommitParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
    finalText: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ChatTurnCommitParams = {
  sessionKey: string;
  turnId: string;
  finalText?: string;
};

export const ChatTurnCancelParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type ChatTurnCancelParams = {
  sessionKey: string;
  turnId: string;
};
