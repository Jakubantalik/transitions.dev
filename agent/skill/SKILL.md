---
name: transitions-agent
description: Scan a codebase for missing, janky, or inconsistent UI motion and fix it with transitions.dev recipes. ALWAYS use this skill when the user's message is or contains a transitions-agent command (npx transitions-agent, npx transitions-agent fix, any variant) - the command is a request for the full guided flow, not just command execution. Also use when the user asks about UI transitions, animations, motion quality, a motion score, janky or missing transitions, "polish the motion", "fix the animations", or whether the motion is good after UI changes.
---

# Transitions Motion Agent

You drive the `transitions-agent` CLI for the user: scan, present choices, run the choice they pick, verify. The scan is deterministic and free; fixes change files, so every fix step needs the user's go-ahead first.

When the user's message is just the scan or fix command (`npx transitions-agent`, `npx transitions-agent fix`, or a variant), that IS the request for this whole workflow: run the scan, then ALWAYS continue to the options step below - never stop at reporting the scan output. `init-ci` is different: it is CI setup only (see CI setup) - never scan or fix as part of it.

## Workflow

1. **Scan** (safe, read-only, no account needed) from the repository root:

   ```bash
   npx transitions-agent@latest --json
   ```

   Report to the user: the motion score (0-100), then the `components` list - every UI component the scan recognized (modal, dropdown, tooltip, toast, accordion, tabs, toggle...) with its motion and the transitions.dev recipe it maps to, marked as matching the recipe, off the motion scale, built wrong, or hand-rolled - then the findings grouped by rule with file:line. Keep it short; lead with the score.

2. **Present exactly these two options** and let the user choose (do not fix without a choice, and do not invent other options such as fixing the findings yourself):
   - **Polish fix** - the transitions-polish treatment: every value moved onto the motion-token scale by what it does (a 300ms modal close becomes 150ms), hover transitions covering what the hover changes, a reduced-motion guard. Small diffs, nothing restructured: `npx transitions-agent@latest fix --yes`
   - **Revamp fix** - everything polish does, plus the transitions.dev recipe installed on each recognized component (Pro recipes included): recipe CSS, state hooks, and the JS for enter and exit. Business plan: `npx transitions-agent@latest fix --mode revamp --yes`

3. **License**: hosted fixes need a key. It resolves from `TRANSITIONS_AGENT_LICENSE`, or `~/.transitions-agent.json`. If neither exists, offer:

   ```bash
   npx transitions-agent@latest signup
   ```

   This opens the user's browser; they enter their email there and the key saves itself. Wait for it to finish, then run the fix. If it reports the key could not be saved (sandboxed agent), pass it on every fix with `--license <key>`.

4. **Verify**: re-run the scan and report the score change (for example "71 to 89"). If the user wants it as a pull request, use `fix --pr` (it creates a branch and opens a PR; it never touches the main branch) - only with their explicit ok.

## CI setup

When the user asks to add the Agent to GitHub Actions / CI, or their message is `npx transitions-agent init-ci` (any flags), set up CI and nothing else: do NOT run a scan or a fix. Run:

```bash
npx transitions-agent@latest init-ci
```

It writes both workflows (score plus automatic fixes on every pull request: a fix pull request into that branch, never main, that the user merges to apply or closes to reject; and a manual fix run from the Actions tab), keeps existing ones, checks the GitHub side, shows which fix modes the user's key allows, and ends with lettered **Options**. Relay a one-line status, then present those options exactly as printed and ask which to do. Automatic fixes default to polish; ask the user which they want when it matters: `--mode revamp` (Business) or `--no-auto-fix` (scores only). Labels on a pull request override it per pull request: `revamp`, `polish`, `no-motion-fix`. Typical options:

- **Sign up or sign in** (no key yet): `npx transitions-agent@latest signup` opens the browser; existing accounts sign in the same way. Wait for it, then re-run `init-ci`.
- **Finish the GitHub side** (license secret + pull request permission): `npx transitions-agent@latest init-ci --yes`. The key never appears in output.
- **Revamp as the default fix mode** (Business keys): `npx transitions-agent@latest init-ci --mode revamp`.
- **Turn on automatic fixes** for an older workflow: `npx transitions-agent@latest init-ci --upgrade`.
- **Commit the workflow files**: on a new branch with a pull request, never straight to main.
- **Create a GitHub repository** when the project has none.

Run only what the user picks. If gh is missing or blocked by a sandbox, give the user the manual steps it printed. Finish when it says "CI is fully set up", or tell the user exactly which step is theirs.

## Network

transitions-agent needs network access: npm has to fetch the current version, and `fix`, `signup`, and `init-ci --yes` talk to api.transitions.dev and GitHub. A sandbox with network off (Codex runs commands that way by default) shows up as one of these:

- `npm error code ETARGET` / "No matching version found" for a version that exists on npm,
- a report header or `--json` `version` older than the latest release (npm served a stale cached copy),
- "Could not reach the fix service", ENOTFOUND, or EAI_AGAIN.

That is the sandbox, never a missing package. Re-run the same command with network access (request escalated permissions or network approval from the user) and tell the user transitions-agent needs network. Never report the package as unavailable, and never present results from an older cached version. Mention the version from the report header when you report a scan.

## Rules

- Never run `fix` without the user choosing to, and never apply motion fixes yourself instead of the service - fixing is the product.
- Never push to the main branch; `--pr` flows are review-first by design.
- Free plan is polish-only; if revamp is refused by the service, relay the upgrade path (transitions.dev/pro.html) without pushing.
- Motion-only changes: if a proposed fix would touch component logic, stop and tell the user.
