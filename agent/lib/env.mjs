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
