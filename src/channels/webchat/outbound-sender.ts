/**
 * Webchat outbound sender — global singleton that the gateway server registers
 * its broadcast function with so the webchat channel plugin can deliver
 * proactive messages (heartbeats, cron results, etc.) to connected WebSocket
 * clients.
 *
 * The gateway calls `registerWebchatBroadcast()` on startup, and the webchat
 * channel plugin calls `getWebchatBroadcast()` at delivery time.
 */

import { resolveGlobalSingleton } from "../../shared/global-singleton.js";

export type WebchatBroadcastFn = (event: string, payload: unknown) => void;

type WebchatOutboundState = {
  broadcast: WebchatBroadcastFn | null;
  /** Number of currently connected webchat clients (updated by the gateway). */
  connectedClients: number;
};

const WEBCHAT_OUTBOUND_STATE_KEY = Symbol.for("openclaw.webchat.outboundState");

const state = resolveGlobalSingleton<WebchatOutboundState>(WEBCHAT_OUTBOUND_STATE_KEY, () => ({
  broadcast: null,
  connectedClients: 0,
}));

/**
 * Register the gateway's broadcast function for webchat outbound delivery.
 * Called once during gateway startup.
 */
export function registerWebchatBroadcast(broadcast: WebchatBroadcastFn): () => void {
  state.broadcast = broadcast;
  return () => {
    if (state.broadcast === broadcast) {
      state.broadcast = null;
    }
  };
}

/**
 * Get the registered broadcast function, or null if the gateway is not running.
 */
export function getWebchatBroadcast(): WebchatBroadcastFn | null {
  return state.broadcast;
}

/**
 * Update the count of connected webchat clients.
 * Called by the gateway when clients connect/disconnect.
 */
export function setWebchatConnectedClients(count: number): void {
  state.connectedClients = Math.max(0, count);
}

/**
 * Check if any webchat clients are currently connected.
 */
export function hasConnectedWebchatClients(): boolean {
  return state.connectedClients > 0;
}

/**
 * Check if webchat outbound delivery is available.
 * Requires the gateway to be running (broadcast registered).
 */
export function isWebchatOutboundAvailable(): boolean {
  return state.broadcast !== null;
}
