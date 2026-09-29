---
name: transitions-agent
description: Scan a codebase for missing, janky, or inconsistent UI motion and fix it with transitions.dev recipes. Use when the user asks about UI transitions, animations, motion quality, a motion score, janky or missing transitions, "polish the motion", "fix the animations", or runs/mentions npx transitions-agent. Also use after UI changes when the user asks whether the motion is good.
---

# Transitions Agent

You drive the `transitions-agent` CLI for the user: scan, present choices, run the choice they pick, verify. The scan is deterministic and free; fixes change files, so every fix step needs the user's go-ahead first.

## Workflow

1. **Scan** (safe, read-only, no account needed) from the repository root:

   ```bash
   npx transitions-agent@latest --json
   ```

   Report to the user: the motion score (0-100), and the findings grouped by rule with file:line. Keep it short; lead with the score.

2. **Present the options** and let the user choose (do not fix without a choice):
   - **Polish fix** - small safe adjustments (motion tokens, reduced-motion guard, named transition properties): `npx transitions-agent@latest fix --yes`
   - **Revamp fix** - everything polish does, plus full rewrites where a finding matches a transitions.dev recipe (Business plan): `npx transitions-agent@latest fix --mode revamp --yes`
   - **Apply locally with me** - no hosted service: the scan findings name recipes at `transitions.dev/transitions/<recipe>`; apply them yourself, or apply a generated `transitions-agent-fixes.md` if present.

3. **License**: hosted fixes need a key. It resolves from `TRANSITIONS_AGENT_LICENSE`, or `~/.transitions-agent.json`. If neither exists, offer:

   ```bash
   npx transitions-agent@latest signup
   ```

   This opens the user's browser; they enter their email there and the key saves itself. Wait for it to finish, then run the fix.

4. **If `fix` wrote `transitions-agent-fixes.md`** (the no-license fallback): after the user agrees, apply the fixes it describes directly in the code, following its instructions exactly, then delete the file.

5. **Verify**: re-run the scan and report the score change (for example "71 to 89"). If the user wants it as a pull request, use `fix --pr` (it creates a branch and opens a PR; it never touches the main branch) - only with their explicit ok.

## Rules

- Never run `fix` or apply changes without the user choosing to.
- Never push to the main branch; `--pr` flows are review-first by design.
- Free plan is polish-only; if revamp is refused by the service, relay the upgrade path (transitions.dev/pro.html) without pushing.
- Motion-only changes: if a proposed fix would touch component logic, stop and tell the user.
