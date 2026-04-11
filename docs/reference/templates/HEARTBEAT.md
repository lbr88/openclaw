---
title: "HEARTBEAT.md Template"
summary: "Workspace template for HEARTBEAT.md"
read_when:
  - Bootstrapping a workspace manually
---

# HEARTBEAT.md Template

```markdown
# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.

## Workflow control loop (optional)

# For long-running work, keep a tiny state machine instead of a vague "check progress" note.

# Track at least:

# - workstream / owner

# - current_phase

# - expected_next_phase

# - blocker / no blocker

# - last verified evidence

# - last intervention result

#

# Invalid resting states (evidence only):

# - PR opened / PR URL posted

# - CI green

# - announce/completion event

# - tool timeout / tool error

#

# The heartbeat should surface only:

# - a real milestone

# - a real blocker

# - a real missed-handoff intervention
```
