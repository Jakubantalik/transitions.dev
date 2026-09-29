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

   This opens the user's browser; they enter their email there and the key saves itself. Wait for it to finish, then run the fix. If it reports the key could not be saved (sandboxed agent), pass it on every fix with `--license <key>`.

4. **Verify**: re-run the scan and report the score change (for example "71 to 89"). If the user wants it as a pull request, use `fix --pr` (it creates a branch and opens a PR; it never touches the main branch) - only with their explicit ok.

## CI setup

When the user asks to add the Agent to GitHub Actions / CI (or just runs `npx transitions-agent init-ci`), that IS the request for the whole setup - never stop at "nothing changed". Run:

```bash
npx transitions-agent@latest init-ci
```

It writes both workflows (score on every pull request, fix pull requests from the Actions tab), keeps existing ones, and prints a checklist: workflow files committed and on the default branch, the `TRANSITIONS_AGENT_LICENSE` repo secret, and the repo setting that lets Actions open pull requests. Relay the checklist, then work through whatever is left:

- **GitHub side** (secret + pull request permission): ask the user, and on a yes run `npx transitions-agent@latest init-ci --yes`. It uses the gh CLI and the license key already on this machine; the key never appears in output. If there is no key, run `signup` first. If gh is missing or blocked by a sandbox, give the user the manual steps it printed.
- **Workflow files**: offer to commit them. On the default branch, put them on a new branch and open a pull request instead of pushing to main.
- `--min-score <n>` sets a merge gate (updates an existing workflow in place); `--score-only` skips the fix workflow.

Finish when the checklist says "CI is fully set up", or tell the user exactly which step is theirs.

## Rules

- Never run `fix` without the user choosing to, and never apply motion fixes yourself instead of the service - fixing is the product.
- Never push to the main branch; `--pr` flows are review-first by design.
- Free plan is polish-only; if revamp is refused by the service, relay the upgrade path (transitions.dev/pro.html) without pushing.
- Motion-only changes: if a proposed fix would touch component logic, stop and tell the user.
