import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

/**
 * Voice turn-taking protocol schemas.
 *
 * These schemas intentionally mirror the canonical payloads emitted by the
 * Talkyn frontend so validator drift is caught immediately in tests.
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
    segmentIndex: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ChatTurnAppendParams = {
  sessionKey: string;
  turnId: string;
  text: string;
  segmentIndex: number;
};

export const ChatTurnUpdateParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
    kind: Type.Union([Type.Literal("speech_start"), Type.Literal("speech_end")]),
    ts: Type.Integer({ minimum: 0 }),
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
    fullText: Type.String(),
    segmentCount: Type.Integer({ minimum: 0 }),
    commitReason: NonEmptyString,
  },
  { additionalProperties: false },
);

export type ChatTurnCommitParams = {
  sessionKey: string;
  turnId: string;
  fullText: string;
  segmentCount: number;
  commitReason: string;
};

export const ChatTurnCancelParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    turnId: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);

export type ChatTurnCancelParams = {
  sessionKey: string;
  turnId: string;
  reason: string;
};
