/**
 * Webchat channel plugin — registers the gateway's built-in webchat (WebSocket)
 * interface as a deliverable channel so heartbeats, cron results, and proactive
 * messages can reach connected clients (e.g. the Talkyn voice app).
 *
 * Unlike external channel plugins (Telegram, Discord, etc.), webchat delivery
 * goes through the gateway's WebSocket broadcast system. The gateway registers
 * its broadcast function via `registerWebchatBroadcast()` on startup.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import type { ChannelOutboundAdapter } from "../plugins/types.adapters.js";
import type { ChannelPlugin } from "../plugins/types.plugin.js";
import {
  getWebchatBroadcast,
  hasConnectedWebchatClients,
  isWebchatOutboundAvailable,
} from "./outbound-sender.js";

// ── Config adapter ──

const WEBCHAT_ACCOUNT_ID = "default";

const webchatConfigAdapter = {
  listAccountIds: (_cfg: OpenClawConfig) => {
    // Webchat is always "configured" when the gateway is running —
    // there's no external token or setup needed.
    return isWebchatOutboundAvailable() ? [WEBCHAT_ACCOUNT_ID] : [];
  },
  resolveAccount: (_cfg: OpenClawConfig, _accountId?: string | null) => ({
    accountId: WEBCHAT_ACCOUNT_ID,
    enabled: true,
  }),
  isEnabled: () => true,
  isConfigured: () => isWebchatOutboundAvailable(),
};

// ── Outbound adapter ──

let messageSeq = 0;

const webchatOutboundAdapter: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  resolveTarget: ({ to }) => {
    // Webchat delivery doesn't use traditional "to" targets.
    // Any non-empty value is fine — we broadcast to all connected clients.
    const target = to?.trim() || "webchat";
    return { ok: true, to: target };
  },
  sendText: async (ctx) => {
    const broadcast = getWebchatBroadcast();
    if (!broadcast) {
      throw new Error("Webchat broadcast not available — gateway not running");
    }
    const id = `webchat-proactive-${Date.now()}-${++messageSeq}`;
    // Use the same chat event format the gateway uses for normal replies
    // so connected webchat/voice app clients can render the message.
    broadcast("chat", {
      runId: id,
      sessionKey: "",
      seq: 1,
      state: "final",
      message: {
        role: "assistant",
        content: ctx.text,
      },
    });
    return {
      channel: INTERNAL_MESSAGE_CHANNEL,
      messageId: id,
    };
  },
  sendMedia: async (ctx) => {
    const broadcast = getWebchatBroadcast();
    if (!broadcast) {
      throw new Error("Webchat broadcast not available — gateway not running");
    }
    const id = `webchat-proactive-${Date.now()}-${++messageSeq}`;
    const text = ctx.text || "";
    const mediaNote = ctx.mediaUrl ? `\n\n[media: ${ctx.mediaUrl}]` : "";
    broadcast("chat", {
      runId: id,
      sessionKey: "",
      seq: 1,
      state: "final",
      message: {
        role: "assistant",
        content: `${text}${mediaNote}`,
      },
    });
    return {
      channel: INTERNAL_MESSAGE_CHANNEL,
      messageId: id,
    };
  },
};

// ── Heartbeat adapter ──

const webchatHeartbeatAdapter = {
  checkReady: async () => {
    if (!isWebchatOutboundAvailable()) {
      return { ok: false, reason: "gateway-not-running" };
    }
    if (!hasConnectedWebchatClients()) {
      return { ok: false, reason: "no-connected-clients" };
    }
    return { ok: true, reason: "ok" };
  },
  resolveRecipients: () => ({
    recipients: ["webchat"],
    source: "webchat-broadcast",
  }),
};

// ── Plugin definition ──

export const webchatPlugin: ChannelPlugin = {
  id: INTERNAL_MESSAGE_CHANNEL,
  meta: {
    id: INTERNAL_MESSAGE_CHANNEL,
    label: "WebChat",
    selectionLabel: "WebChat (Gateway UI)",
    docsPath: "/channels/webchat",
    blurb: "built-in gateway WebSocket interface for web and voice app clients.",
    order: 100, // After all external channels
    showConfigured: false,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    polls: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: false,
    threads: false,
    groupManagement: false,
    nativeCommands: false,
  },
  config: webchatConfigAdapter,
  outbound: webchatOutboundAdapter,
  heartbeat: webchatHeartbeatAdapter,
};
