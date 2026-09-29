// Who is on the other end of this process.
//
// A TTY check alone is not enough: Codex (and some other agents) run
// commands inside a pseudo-terminal, so isTTY is true while no human can
// answer. Prompting there makes the agent answer for the user.

const AGENT_ENV = [
  (k) => k === "CLAUDECODE",
  (k) => k.startsWith("CODEX"),
  (k) => k.startsWith("CURSOR_AGENT"),
  (k) => k === "AIDER_MODEL" || k.startsWith("AIDER_"),
];

export function runByAgent() {
  return Object.keys(process.env).some((k) => AGENT_ENV.some((test) => test(k)));
}

// A human can answer prompts: real terminal, not CI, not an agent.
export function isInteractive() {
  return !!process.stdin.isTTY && !process.env.CI && !runByAgent();
}

// Codex runs commands in a sandbox that blocks network by default and says so
// in the environment. npm then serves whatever version it cached earlier (or
// fails with ETARGET), and nothing can reach transitions.dev.
export function sandboxNoNetwork() {
  return process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1";
}

export const NETWORK_HELP =
  "This command needs network access: npm fetches the current transitions-agent, and fixes and signup talk to " +
  "api.transitions.dev. The sandbox running it has network turned off (Codex does this by default). Allow network " +
  "for transitions-agent commands (approve the request, or enable network access in the agent's settings) and run it again.";
