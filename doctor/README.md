# transitions-doctor

Scan your codebase for missing, janky, or inconsistent UI transitions. Get a motion score (0-100), findings with matching [transitions.dev](https://transitions.dev) recipes, AI-proposed fixes shown as diffs, and an optional pull request. Nothing is ever changed without your explicit confirmation, and nothing is ever pushed to your main branch.

## Terminal

```bash
npx transitions-doctor          # scan: motion score + findings + recipes
npx transitions-doctor fix      # propose fixes as diffs, confirm, apply
npx transitions-doctor fix --pr # after applying: branch, commit, push, open a PR
```

The `fix` command sends the affected files to the hosted fix service (your license key, our AI). Without a license key it writes `transitions-doctor-fixes.md`, a ready-made task for your own Claude Code or Cursor.

Flags: `--json`, `--md`, `--dir <path>`, `--min-score <n>` (exit 2 below n, for CI), `--license <key>` (or `TRANSITIONS_DOCTOR_LICENSE`), `--yes` (skip prompts).

## GitHub Action

Copy [templates/transitions-doctor.yml](templates/transitions-doctor.yml) to `.github/workflows/` in your repository. Every pull request then gets a motion score comment, and `min-score` can block merges when motion quality drops:

```yaml
- uses: actions/checkout@v4
- uses: Jakubantalik/transitions.dev/doctor@main
  with:
    min-score: "75"
```

## What it checks

| Rule | What it catches |
|---|---|
| untransitioned-overlay | Modals, tooltips, dropdowns that pop in and out with no transition |
| hover-without-transition | Hover states that snap instead of easing |
| transition-all | `transition: all`, which animates layout and hurts performance |
| hardcoded-duration | Literal durations instead of shared motion tokens |
| no-reduced-motion | Animation with no `prefers-reduced-motion` guard |
| inconsistent-durations | Too many different duration values across the project |

## Safety model

1. Proposed fixes are shown as diffs first; nothing is written without a yes.
2. `--pr` opens a pull request on a new branch; your team reviews, your tests run, a human merges.
3. Everything is git; any merged fix is one `git revert` away.
4. Fixes touch motion only (CSS transitions, animation guards), never logic.

## Hosted fix service

`worker/` contains the Cloudflare Worker behind `api.transitions.dev/v1/doctor/fix`: it validates the license key, meters monthly fix quota, and calls Claude with the service key. Teams never handle an AI key. See [worker/wrangler.toml](worker/wrangler.toml) for deployment.

MIT for the scanner and CLI. The fix service requires a Transitions Doctor license from [transitions.dev](https://transitions.dev).
