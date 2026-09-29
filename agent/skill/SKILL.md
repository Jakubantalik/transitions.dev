---
name: transitions-agent
description: Scan a codebase for missing, janky, or inconsistent UI motion and fix it with transitions.dev recipes. ALWAYS use this skill when the user's message is or contains a transitions-agent command (npx transitions-agent, npx transitions-agent fix, any variant) - the command is a request for the full guided flow, not just command execution. Also use when the user asks about UI transitions, animations, motion quality, a motion score, janky or missing transitions, "polish the motion", "fix the animations", or whether the motion is good after UI changes.
---

# Transitions Agent

You drive the `transitions-agent` CLI for the user: scan, present choices, run the choice they pick, verify. The scan is deterministic and free; fixes change files, so every fix step needs the user's go-ahead first.

When the user's message is just the command (`npx transitions-agent` or a variant), that IS the request for this whole workflow: run the scan, then ALWAYS continue to the options step below - never stop at reporting the scan output.

## Workflow

1. **Scan** (safe, read-only, no account needed) from the repository root:

   ```bash
   npx transitions-agent@latest --json
   ```

   Report to the user: the motion score (0-100), and the findings grouped by rule with file:line. Keep it short; lead with the score.

2. **Present exactly these two options** and let the user choose (do not fix without a choice, and do not invent other options such as fixing the findings yourself):
   - **Polish fix** - small safe adjustments (motion tokens, reduced-motion guard, named transition properties): `npx transitions-agent@latest fix --yes`
   - **Revamp fix** - everything polish does, plus full rewrites where a finding matches a transitions.dev recipe (Business plan): `npx transitions-agent@latest fix --mode revamp --yes`

3. **License**: hosted fixes need a key. It resolves from `TRANSITIONS_AGENT_LICENSE`, or `~/.transitions-agent.json`. If neither exists, offer:

   ```bash
   npx transitions-agent@latest signup
   ```

   This opens the user's browser; they enter their email there and the key saves itself. Wait for it to finish, then run the fix.

4. **Verify**: re-run the scan and report the score change (for example "71 to 89"). If the user wants it as a pull request, use `fix --pr` (it creates a branch and opens a PR; it never touches the main branch) - only with their explicit ok.

## CI setup

When the user asks to add the Agent to GitHub Actions / CI, run:

```bash
npx transitions-agent@latest init-ci
```

Add `--fix` for the fix-PR workflow and `--min-score <n>` for a merge gate. Then tell the user to commit the new workflow files; for hosted fix PRs they add one repo secret, `TRANSITIONS_AGENT_LICENSE`.

## Rules

- Never run `fix` without the user choosing to, and never apply motion fixes yourself instead of the service - fixing is the product.
- Never push to the main branch; `--pr` flows are review-first by design.
- Free plan is polish-only; if revamp is refused by the service, relay the upgrade path (transitions.dev/pro.html) without pushing.
- Motion-only changes: if a proposed fix would touch component logic, stop and tell the user.
