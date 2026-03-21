import { describe, expect, it } from "vitest";
import { voiceTurnFrontendContract, withUnexpectedProperty } from "../test-helpers.voice-turns.js";
import {
  formatValidationErrors,
  validateChatTurnAppendParams,
  validateChatTurnCancelParams,
  validateChatTurnCommitParams,
  validateChatTurnStartParams,
  validateChatTurnUpdateParams,
} from "./index.js";

function omitKey<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const next = { ...value };
  delete next[key];
  return next;
}

describe("voice turn protocol contract validators", () => {
  const validCases = [
    {
      name: "chat.turn.start",
      validate: validateChatTurnStartParams,
      params: voiceTurnFrontendContract.start(),
    },
    {
      name: "chat.turn.append",
      validate: validateChatTurnAppendParams,
      params: voiceTurnFrontendContract.append(),
    },
    {
      name: "chat.turn.update",
      validate: validateChatTurnUpdateParams,
      params: voiceTurnFrontendContract.update(),
    },
    {
      name: "chat.turn.commit",
      validate: validateChatTurnCommitParams,
      params: voiceTurnFrontendContract.commit(),
    },
    {
      name: "chat.turn.cancel",
      validate: validateChatTurnCancelParams,
      params: voiceTurnFrontendContract.cancel(),
    },
  ] as const;

  it.each(validCases)("accepts canonical frontend $name payloads", ({ validate, params }) => {
    expect(validate(params)).toBe(true);
  });

  const missingRequiredCases = [
    {
      name: "chat.turn.append.segmentIndex",
      validate: validateChatTurnAppendParams,
      params: omitKey(voiceTurnFrontendContract.append(), "segmentIndex"),
      expectedMessage: "segmentIndex",
    },
    {
      name: "chat.turn.update.ts",
      validate: validateChatTurnUpdateParams,
      params: omitKey(voiceTurnFrontendContract.update(), "ts"),
      expectedMessage: "ts",
    },
    {
      name: "chat.turn.commit.fullText",
      validate: validateChatTurnCommitParams,
      params: omitKey(voiceTurnFrontendContract.commit(), "fullText"),
      expectedMessage: "fullText",
    },
    {
      name: "chat.turn.commit.segmentCount",
      validate: validateChatTurnCommitParams,
      params: omitKey(voiceTurnFrontendContract.commit(), "segmentCount"),
      expectedMessage: "segmentCount",
    },
    {
      name: "chat.turn.commit.commitReason",
      validate: validateChatTurnCommitParams,
      params: omitKey(voiceTurnFrontendContract.commit(), "commitReason"),
      expectedMessage: "commitReason",
    },
    {
      name: "chat.turn.cancel.reason",
      validate: validateChatTurnCancelParams,
      params: omitKey(voiceTurnFrontendContract.cancel(), "reason"),
      expectedMessage: "reason",
    },
  ] as const;

  it.each(missingRequiredCases)("requires $name", ({ validate, params, expectedMessage }) => {
    expect(validate(params)).toBe(false);
    expect(formatValidationErrors(validate.errors)).toContain(expectedMessage);
  });

  it.each(validCases)(
    "rejects unexpected properties for $name payloads",
    ({ validate, params }) => {
      expect(validate(withUnexpectedProperty(params))).toBe(false);
      expect(formatValidationErrors(validate.errors)).toContain("unexpected property");
    },
  );
});
