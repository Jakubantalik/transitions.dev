# transitions-agent

Scan your codebase for missing, janky, or inconsistent UI transitions. Get a motion score (0-100), findings with matching [transitions.dev](https://transitions.dev) recipes, AI-proposed fixes shown as diffs, and an optional pull request. Nothing is ever changed without your explicit confirmation, and nothing is ever pushed to your main branch.

## Terminal

```bash
npx transitions-agent                     # scan: motion score + findings + recipes
npx transitions-agent skill               # install the agent skill (Claude Code drives the whole flow)
npx transitions-agent signup              # free plan: sign up in the browser (or: signup you@x.com)
npx transitions-agent fix                 # propose fixes as diffs, confirm, apply
npx transitions-agent fix --pr            # after applying: branch, commit, push, open a PR
```

`skill` installs a Claude Code skill (`~/.claude/skills/transitions-agent/`, `--dir` for other agents): from then on "check this app's motion" makes your agent scan, present the fix options, run your choice, and verify the score - the trusted-context version of the CLI's next-steps menu.

The `fix` command sends the affected files to the hosted fix service (your license key, our AI). Without a license key it points you to the free signup - hosted fixes are the fix path.

### Fix modes

| Mode | What it does | Risk |
|---|---|---|
| `--mode polish` (default) | The transitions-polish treatment: every value moved onto the transitions.dev motion-token scale by what it does (a 300ms modal close becomes 150ms, a 0.8 modal scale becomes 0.96), hover transitions covering what the hover changes, `prefers-reduced-motion` guard, named properties instead of `transition: all`. Never restructures anything. | Minimal, few-line diffs |
| `--mode revamp` (Business plan) | Polish plus the transitions.dev skill: each recognized component gets its library recipe installed (recipe CSS, state hooks, and the JS for enter and exit), Pro recipes included. Logic is never touched. | Larger diffs, review the PR |

### What the scan recognizes

The scan reviews a project the way the transitions.dev skill does. It recognizes each UI component the library covers (modals, dropdowns, popovers, tooltips, toasts, drawers, accordions, tabs, toggles, checkboxes, badges, skeletons, and the rest of the 32 free and 11 Pro recipes) from class names, elements, ARIA roles, component names, Tailwind utilities, and Framer Motion props. It reads what each one's motion actually does (open and close timing, easing, scale, travel, exit, animated properties) and compares it with the recipe by usage. Components built from the library's `t-*` hooks are checked against the recipe's tunable defaults.

Findings: `off-scale` (a value off the scale for its usage, with from and to), `recipe-mismatch` (motion built wrong for the component: animates layout, no exit, pops in), `recipe-available` (hand-rolled, the library has a recipe; no score penalty), plus the rules for hover coverage, `transition: all`, slow and hardcoded durations, and reduced motion. `--json` includes the full `components` list.

```bash
npx transitions-agent fix                # polish: values onto the motion scale
npx transitions-agent fix --mode revamp  # install library recipes on recognized components
```

Flags: `--json`, `--md`, `--dir <path>`, `--min-score <n>` (exit 2 below n, for CI), `--mode polish|revamp`, `--license <key>` (or `TRANSITIONS_AGENT_LICENSE`), `--yes` (skip prompts).

## GitHub Action

`npx transitions-agent init-ci` sets it up (or copy [templates/transitions-agent.yml](templates/transitions-agent.yml) to `.github/workflows/`). Every pull request then gets:

- a motion score comment with the recognized components and findings, updated in place on every push;
- automatic fixes: when there is something to fix, one fix pull request into that pull request's branch (never main), linked from the comment. Merge it to apply the fixes, close it to reject them. Its description says, per component and in plain words, what someone using the app will notice ("Opens in 250ms instead of 800ms", "Animates out when it closes instead of disappearing instantly"), what is still open, and folds the technical notes away;
- an optional merge gate with `min-score`.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: Jakubantalik/transitions.dev/agent@main
  with:
    min-score: "0"      # fail the check below this score (0 = report only)
    auto-fix: "true"    # propose fixes as a pull request into the branch
    fix-mode: "polish"  # or "revamp" (Business)
    license: ${{ secrets.TRANSITIONS_AGENT_LICENSE }}
```

Automatic fixes need the license secret, `contents: write` and `pull-requests: write` permissions, and the repository setting that lets Actions create pull requests (`init-ci --yes` handles the secret and the setting). They cost one hosted fix per run and are guarded: a pull request is fixed once, and again only when someone changes style or component files (the agent's own commits and merges do not count). Forks, the fix branches themselves, and pull requests already at the `min-score` gate are skipped.

Labels on a pull request: `revamp` installs the transitions.dev recipes for that pull request (Business), `polish` forces polish, `no-motion-fix` skips fixes. `init-ci --mode revamp` makes revamp the default; `init-ci --no-auto-fix` keeps it to scores only; `init-ci --upgrade` moves an older workflow to this one.

## What it checks

| Rule | What it catches |
|---|---|
| recipe-mismatch | A component's motion built wrong for it: animates height or top, no exit, pops in, unmounts instantly |
| off-scale | A value off the motion scale for its usage (modal close 300ms, scale 0.8, linear surfaces, hover ease-in) |
| recipe-available | A hand-rolled component the library has a recipe for (no score penalty) |
| untransitioned-overlay | Modals, tooltips, dropdowns that pop in and out with no transition |
| hover-without-transition | Hover states that snap because the transition does not cover what changes |
| layout-animation | Hover shifts that move layout (padding, margin, width) |
| transition-all | `transition: all`, which animates layout and hurts performance |
| slow-duration | Transitions over a second, including through tokens |
| hardcoded-duration | Literal durations instead of shared motion tokens |
| no-reduced-motion | Animation with no `prefers-reduced-motion` guard |
| inconsistent-durations | Too many different duration values across the project |

## MCP server (your AI, our recipes)

Prefer your own Claude to do the fixing? Connect the Transitions Agent MCP server and your assistant gets the scanner contract, the fix guidance, and the real recipe sources (Pro included on Business) - fixing runs on your subscription, not our meters:

```bash
claude mcp add --transport http transitions-agent https://api.transitions.dev/v1/agent/mcp --header "Authorization: Bearer $TRANSITIONS_AGENT_LICENSE"
```

Tools: `scan_instructions`, `fix_guidance(mode)`, `list_recipes`, `get_recipe(slug, variant)`. Free recipes need no key; Pro recipe sources need a paid plan (Pro, Business, or Enterprise).

### Fixing from CI

Two workflow templates, pick by who supplies the AI:

- **[transitions-fix.yml](templates/transitions-fix.yml)** (one secret, the license key): a whole-repository fix run from the Actions tab. Fixes run through the hosted service on our AI, metered against the plan, and land as a pull request into the branch you run it on. Pull requests get their fixes automatically from the score workflow above.
- **[transitions-fix-own-claude.yml](templates/transitions-fix-own-claude.yml)** (Enterprise license required): runs `claude-code-action` on your own Anthropic key, connected to this MCP server. Unmetered, and your code never flows through our fix service - it goes only to Anthropic under your own agreement. CI automation on your own model keys is licensed on the Enterprise plan (org-wide license, custom rules, priority support); Business licenses hosted CI fixing only.

The score/gate Action stays AI-free either way.

## Safety model

1. Proposed fixes are shown as diffs first; nothing is written without a yes.
2. `--pr` opens a pull request on a new branch; your team reviews, your tests run, a human merges.
3. Everything is git; any merged fix is one `git revert` away.
4. Fixes touch motion only (CSS transitions, animation guards), never logic.

## Hosted fix service

`worker/` contains the Cloudflare Worker behind `api.transitions.dev/v1/agent/fix`: it validates the license key, meters monthly fix quota, and calls Claude with the service key. Teams never handle an AI key. See [worker/wrangler.toml](worker/wrangler.toml) for deployment.

In revamp mode the service feeds the model the real transitions.dev recipe sources, Pro recipes included, so rewrites match the library exactly instead of an approximation. [worker/pack-recipes.mjs](worker/pack-recipes.mjs) packs the free and Pro recipe files into the RECIPES KV namespace; re-run it whenever recipes change.

## Plans

| | Scan + score + Action | Fix via your own Claude Code/Cursor | Hosted polish fixes | Hosted revamp (Pro recipes) |
|---|---|---|---|---|
| **Free** (sign-up) | unlimited | unlimited | 10/month, 2/day | no |
| **Business** ($59/month, includes Transitions Pro for 5 seats) | unlimited | unlimited | 200/month | yes |

The Transitions.dev **Pro** plan ($9/month) includes the free Agent tier; the paid Agent comes with the **Business** plan. In the license KV the paid tier is still stored as `plan:"team"`.

Free hosted fixes run on a faster model and share a global monthly capacity pool (`FREE_GLOBAL_MONTHLY` in [worker/wrangler.toml](worker/wrangler.toml)), so free-tier AI spend has a hard ceiling. Team traffic is never affected by the pool.

MIT for the scanner and CLI. The fix service requires a Transitions Agent license from [transitions.dev](https://transitions.dev).
