---
title: "Workflow Control Loop Template"
summary: "Template for explicit state-machine handoff tracking in long-running work"
read_when:
  - Designing a follow-up helper, heartbeat, or watchdog for multi-step work
---

# Workflow Control Loop Template

Use a tiny explicit state machine when work should keep moving across routine handoffs.

## Minimum fields per lane

- workstream
- owner
- `current_phase`
- `expected_next_phase`
- blocker / no blocker
- last verified evidence
- last intervention result

## Example phases

- `implementing`
- `review_pending`
- `review_running`
- `merge_ready`
- `integrating`
- `blocker`

## Invalid resting states

Treat these as **evidence only**, not stable waiting states:

- PR opened / PR URL posted
- CI green
- board move / label change
- announce/completion event
- tool timeout / tool error

## Example operating rule

- If `current_phase = review_pending`, the next expected phase is `review_running`.
- If `current_phase = merge_ready`, the next expected phase is usually `integrating`.
- If a steering tool times out or errors, the attempted handoff is **unverified** until the downstream state is checked.

## Example record

```json
{
  "workstream": "Issue #123 - fix upload previews",
  "owner": "lead session abc",
  "current_phase": "review_pending",
  "expected_next_phase": "review_running",
  "blocker": null,
  "last_verified_evidence": "PR exists, CI green, no review session yet",
  "last_intervention_result": "steered lead; unverified until session check"
}
```

The point is simple: watch for **missing transitions**, not vague motion.
