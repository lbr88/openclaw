/**
 * WebSocket handlers for the voice turn-taking protocol.
 *
 * These handlers receive `chat.turn.*` methods from the Talkyn frontend,
 * track per-session draft state via VoiceTurnState, and gate the followup
 * queue drain while a voice turn is in progress.
 *
 * Refs: lbr88/talkyn-native#170
 */

import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type ChatTurnAppendParams,
  type ChatTurnCancelParams,
  type ChatTurnCommitParams,
  type ChatTurnStartParams,
  type ChatTurnUpdateParams,
  validateChatTurnAppendParams,
  validateChatTurnCancelParams,
  validateChatTurnCommitParams,
  validateChatTurnStartParams,
  validateChatTurnUpdateParams,
} from "../protocol/index.js";
import {
  appendVoiceTurnText,
  cancelVoiceTurn,
  clearVoiceTurn,
  commitVoiceTurn,
  startVoiceTurn,
  updateVoiceTurnSpeech,
} from "../voice-turn-state.js";
import type { GatewayRequestHandlers } from "./types.js";

export const chatVoiceTurnHandlers: GatewayRequestHandlers = {
  "chat.turn.start": ({ params, respond, context, client }) => {
    if (!validateChatTurnStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turn.start params: ${formatValidationErrors(validateChatTurnStartParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, turnId } = params;
    const connId = client?.connId ?? "";

    const result = startVoiceTurn({
      sessionKey,
      turnId,
      connId,
      onTimeout: (state) => {
        context.logGateway.warn(
          `voice turn failsafe timeout: sessionKey=${state.sessionKey} turnId=${state.turnId} connId=${state.connId} durationMs=${Date.now() - state.startedAtMs}`,
        );
        // Broadcast a turn-cancelled event so any listening clients know.
        context.broadcast("chat.turn.timeout", {
          sessionKey: state.sessionKey,
          turnId: state.turnId,
          reason: "failsafe_timeout",
          ts: Date.now(),
        });
      },
    });

    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }

    context.logGateway.debug(
      `voice turn started: sessionKey=${sessionKey} turnId=${turnId} connId=${connId}`,
    );
    respond(true, { ok: true, turnId });
  },

  "chat.turn.append": ({ params, respond }) => {
    if (!validateChatTurnAppendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turn.append params: ${formatValidationErrors(validateChatTurnAppendParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, turnId, text, segmentIndex } = params;

    const result = appendVoiceTurnText(sessionKey, turnId, text, segmentIndex);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason!));
      return;
    }
    respond(true, { ok: true });
  },

  "chat.turn.update": ({ params, respond }) => {
    if (!validateChatTurnUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turn.update params: ${formatValidationErrors(validateChatTurnUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, turnId, kind } = params;

    const result = updateVoiceTurnSpeech(sessionKey, turnId, kind);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason!));
      return;
    }
    respond(true, { ok: true });
  },

  "chat.turn.commit": async ({ params, respond, context }) => {
    if (!validateChatTurnCommitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turn.commit params: ${formatValidationErrors(validateChatTurnCommitParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, turnId, fullText, segmentCount, commitReason } = params;

    const result = commitVoiceTurn(sessionKey, turnId, fullText);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }

    const { text } = result;
    if (!text) {
      // Empty commit — nothing to send to the agent.
      context.logGateway.debug(
        `voice turn committed (empty): sessionKey=${sessionKey} turnId=${turnId} segmentCount=${segmentCount} commitReason=${commitReason}`,
      );
      respond(true, { ok: true, turnId, submitted: false });
      return;
    }

    context.logGateway.debug(
      `voice turn committed: sessionKey=${sessionKey} turnId=${turnId} segmentCount=${segmentCount} commitReason=${commitReason} textLen=${text.length}`,
    );

    // Dispatch the committed text as a chat.send. We invoke the handler
    // indirectly by calling the existing chat.send handler with a
    // synthesized idempotency key derived from the turnId.
    //
    // However, to keep this implementation clean and decoupled, we just
    // respond with the committed text and let the frontend call chat.send
    // with the final text. The gateway's job in the turn protocol is to
    // hold the queue and track state — not to auto-send.
    respond(true, { ok: true, turnId, submitted: true, text });
  },

  "chat.turn.cancel": ({ params, respond, context }) => {
    if (!validateChatTurnCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turn.cancel params: ${formatValidationErrors(validateChatTurnCancelParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, turnId, reason } = params;

    const result = cancelVoiceTurn(sessionKey, turnId);
    if (!result.ok) {
      // Be lenient: if there's no active turn, still respond OK.
      // The frontend may cancel defensively.
      const cleared = clearVoiceTurn(sessionKey);
      context.logGateway.debug(
        `voice turn cancel (no match): sessionKey=${sessionKey} turnId=${turnId} reason=${reason} cleared=${cleared}`,
      );
      respond(true, { ok: true, turnId, cancelled: cleared });
      return;
    }

    context.logGateway.debug(
      `voice turn cancelled: sessionKey=${sessionKey} turnId=${turnId} reason=${reason}`,
    );
    respond(true, { ok: true, turnId, cancelled: true });
  },
};
