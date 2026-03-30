/**
 * Workflow event broker for orchestration.
 *
 * Provides a stable event envelope (WorkflowEvent) and an in-memory replay
 * buffer with cursor-based replay for v1. Listeners, per-connection subscribers,
 * and one-shot waiters are all managed here so the gateway and agent tools have
 * a single source of truth.
 *
 * Design goals:
 * - Additive / backward-compatible: nothing here breaks existing flows.
 * - Stable public envelope: raw agent events are not exposed directly.
 * - Replay buffer supports `afterCursor` for reconnecting clients to detect gaps.
 */

import { randomUUID } from "node:crypto";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WorkflowEventKind =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "subagent.spawned"
  | "subagent.completed"
  | "subagent.failed";

export type WorkflowEvent = {
  /** Stable identifier for this event instance. */
  id: string;
  /** Monotonically increasing integer across all workflow events on this gateway. */
  cursor: number;
  kind: WorkflowEventKind;
  ts: number;
  /** Session that owns or originated this run. */
  sessionKey?: string;
  /** Run identifier (corresponds to agent run). */
  runId?: string;
  /** For subagent.* events: the spawning session. */
  parentSessionKey?: string;
  /** For subagent.* events: the spawned session. */
  childSessionKey?: string;
  /** Kind-specific extra fields. */
  data: Record<string, unknown>;
};

export type WorkflowEventFilter = {
  /** If set, only events whose kind is in this list will be delivered. */
  kinds?: WorkflowEventKind[];
  /** If set, only events where sessionKey, parentSessionKey, or childSessionKey matches. */
  sessionKey?: string;
};

export type WorkflowSubscriberCallback = (evt: WorkflowEvent) => void;

// ---------------------------------------------------------------------------
// Broker state (process-global singleton so tests can reset it)
// ---------------------------------------------------------------------------

const REPLAY_BUFFER_MAX = 500;

type WorkflowWaiter = {
  id: string;
  filter: WorkflowEventFilter;
  resolve: (evt: WorkflowEvent) => void;
  /** Session key of the waiting agent (to avoid self-wake). */
  callerSessionKey?: string;
  timer: NodeJS.Timeout | null;
};

type WorkflowSubscriber = {
  connId: string;
  filter: WorkflowEventFilter;
  callback: WorkflowSubscriberCallback;
};

type WorkflowBrokerState = {
  cursor: number;
  buffer: WorkflowEvent[];
  subscribers: Map<string, WorkflowSubscriber>; // keyed by connId
  rawListeners: Set<WorkflowSubscriberCallback>;
  waiters: Map<string, WorkflowWaiter>; // keyed by waiter id
};

const BROKER_STATE_KEY = Symbol.for("openclaw.workflowEvents.brokerState");

const state = resolveGlobalSingleton<WorkflowBrokerState>(BROKER_STATE_KEY, () => ({
  cursor: 0,
  buffer: [],
  subscribers: new Map(),
  rawListeners: new Set(),
  waiters: new Map(),
}));

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Check whether an event matches a filter. */
export function matchesWorkflowFilter(evt: WorkflowEvent, filter: WorkflowEventFilter): boolean {
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(evt.kind)) {
      return false;
    }
  }
  if (filter.sessionKey) {
    const sk = filter.sessionKey;
    if (evt.sessionKey !== sk && evt.parentSessionKey !== sk && evt.childSessionKey !== sk) {
      return false;
    }
  }
  return true;
}

/**
 * Emit a workflow event into the broker. All subscribers and waiters are
 * notified synchronously. The event is appended to the replay buffer.
 */
export function emitWorkflowEvent(partial: Omit<WorkflowEvent, "id" | "cursor">): WorkflowEvent {
  const evt: WorkflowEvent = {
    ...partial,
    id: randomUUID(),
    cursor: ++state.cursor,
  };

  // Append to replay buffer, evicting oldest if full.
  state.buffer.push(evt);
  if (state.buffer.length > REPLAY_BUFFER_MAX) {
    state.buffer.shift();
  }

  // Deliver to raw listeners.
  for (const listener of state.rawListeners) {
    try {
      listener(evt);
    } catch {
      /* ignore listener errors */
    }
  }

  // Deliver to per-connection subscribers.
  for (const sub of state.subscribers.values()) {
    if (!matchesWorkflowFilter(evt, sub.filter)) {
      continue;
    }
    try {
      sub.callback(evt);
    } catch {
      /* ignore */
    }
  }

  // Wake one-shot waiters.
  for (const [waiterId, waiter] of state.waiters) {
    if (!matchesWorkflowFilter(evt, waiter.filter)) {
      continue;
    }
    // Avoid self-wake: if the event originates from the same session as the
    // waiter's orchestrator turn, skip it. The orchestrator already knows what
    // it just did; waking itself would create an infinite loop footgun.
    if (
      waiter.callerSessionKey &&
      (evt.sessionKey === waiter.callerSessionKey ||
        evt.parentSessionKey === waiter.callerSessionKey)
    ) {
      continue;
    }
    state.waiters.delete(waiterId);
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    try {
      waiter.resolve(evt);
    } catch {
      /* ignore */
    }
    // Only wake the first matching waiter per event (one-shot semantics).
    break;
  }

  return evt;
}

// ---------------------------------------------------------------------------
// Subscriptions (for gateway per-connection delivery)
// ---------------------------------------------------------------------------

/** Register or replace a per-connection subscriber. */
export function subscribeWorkflowEvents(
  connId: string,
  filter: WorkflowEventFilter,
  callback: WorkflowSubscriberCallback,
): void {
  state.subscribers.set(connId, { connId, filter, callback });
}

/** Remove a per-connection subscriber. */
export function unsubscribeWorkflowEvents(connId: string): void {
  state.subscribers.delete(connId);
}

// ---------------------------------------------------------------------------
// Raw listeners (for internal use, e.g. bridge + tests)
// ---------------------------------------------------------------------------

/** Subscribe to all workflow events (unfiltered). Returns an unsubscribe fn. */
export function onWorkflowEvent(listener: WorkflowSubscriberCallback): () => void {
  state.rawListeners.add(listener);
  return () => state.rawListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type WorkflowReplayResult = {
  events: WorkflowEvent[];
  /**
   * The cursor of the most recent event in the full buffer (not just the
   * replayed slice). Clients can compare this with the last event they see to
   * detect whether a gap has occurred and decide to do a full refresh.
   */
  bufferHead: number;
  /**
   * The oldest cursor in the replay buffer. If `afterCursor` is older than
   * this, events before `oldestCursor` have already been evicted and the
   * client should treat it as a gap.
   */
  oldestCursor: number;
};

/**
 * Return buffered events after `afterCursor`, optionally filtered.
 * Pass `afterCursor = 0` to get all buffered events.
 */
export function replayWorkflowEvents(
  afterCursor: number,
  filter?: WorkflowEventFilter,
): WorkflowReplayResult {
  const oldest = state.buffer.length > 0 ? (state.buffer[0]?.cursor ?? 0) : 0;
  const head = state.buffer.length > 0 ? (state.buffer[state.buffer.length - 1]?.cursor ?? 0) : 0;
  const events = state.buffer.filter(
    (e) => e.cursor > afterCursor && (!filter || matchesWorkflowFilter(e, filter)),
  );
  return { events, bufferHead: head, oldestCursor: oldest };
}

// ---------------------------------------------------------------------------
// One-shot waiters (for orchestrator session wait/wake)
// ---------------------------------------------------------------------------

/**
 * Register a one-shot waiter that resolves when a matching event is emitted.
 * Returns a promise that resolves to the matching event, or rejects on timeout.
 *
 * @param callerSessionKey  If provided, prevents self-wake when the caller's
 *   own run emits an event matching the filter.
 */
export function waitForWorkflowEvent(
  filter: WorkflowEventFilter,
  timeoutMs: number,
  callerSessionKey?: string,
): Promise<WorkflowEvent> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            state.waiters.delete(id);
            reject(new Error(`workflow_wait timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;

    state.waiters.set(id, {
      id,
      filter,
      resolve,
      callerSessionKey,
      timer,
    });
  });
}

/**
 * Cancel all pending waiters for a given session (call on session teardown).
 */
export function clearWorkflowWaitersForSession(sessionKey: string): void {
  for (const [id, waiter] of state.waiters) {
    if (waiter.callerSessionKey === sessionKey) {
      state.waiters.delete(id);
      if (waiter.timer) {
        clearTimeout(waiter.timer);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function resetWorkflowEventsForTest(): void {
  state.cursor = 0;
  state.buffer.length = 0;
  state.subscribers.clear();
  state.rawListeners.clear();
  for (const waiter of state.waiters.values()) {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
  }
  state.waiters.clear();
}

/** Snapshot of current broker state for assertions. */
export function getWorkflowBrokerSnapshot() {
  return {
    cursor: state.cursor,
    bufferSize: state.buffer.length,
    subscriberCount: state.subscribers.size,
    waiterCount: state.waiters.size,
  };
}
