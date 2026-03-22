/**
 * Gateway handlers for the workflow event subscription API.
 *
 * Methods:
 *   workflow.subscribe   – register or replace a per-connection subscription
 *   workflow.unsubscribe – remove the subscription for this connection
 *
 * Server event:
 *   workflow.event – delivered to subscribed connections only
 *
 * Backward compatibility:
 *   These methods are purely additive. Clients that do not call
 *   workflow.subscribe receive no workflow.event events. Existing connections
 *   are unaffected. See docs/workflow-events.md for the Talkyn integration
 *   guide and fallback story.
 */

import {
  ErrorCodes,
  errorShape,
  validateWorkflowSubscribeParams,
  validateWorkflowUnsubscribeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const workflowHandlers: GatewayRequestHandlers = {
  "workflow.subscribe": ({ params, client, respond, context }) => {
    if (!validateWorkflowSubscribeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid workflow.subscribe params"),
      );
      return;
    }
    const connId = client?.connId;
    if (!connId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no connection id"));
      return;
    }

    const { afterCursor, kinds, sessionKey } = params;
    const filter = {
      kinds,
      sessionKey,
    };

    // Register or replace the subscriber for this connection.
    context.subscribeWorkflowEvents(connId, filter);

    // Replay buffered events if requested.
    const replay = context.replayWorkflowEvents(afterCursor ?? 0, filter);

    respond(true, {
      subscribed: true,
      bufferHead: replay.bufferHead,
      oldestCursor: replay.oldestCursor,
      replayed: replay.events,
    });
  },

  "workflow.unsubscribe": ({ params, client, respond, context }) => {
    if (!validateWorkflowUnsubscribeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid workflow.unsubscribe params"),
      );
      return;
    }
    const connId = client?.connId;
    if (connId) {
      context.unsubscribeWorkflowEvents(connId);
    }
    respond(true, { unsubscribed: true });
  },
};
