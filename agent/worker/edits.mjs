// The model's answer: read from Anthropic's event stream, then applied as
// search-and-replace edits to the files the client sent.

// Apply edits per file, all or nothing: a file with any edit that does not
// match exactly once is returned untouched rather than half-fixed.
export function applyEdits(files, edits) {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const next = new Map();
  const bad = new Set();
  for (const e of edits) {
    if (!e || typeof e.path !== "string" || typeof e.find !== "string" || typeof e.replace !== "string") continue;
    if (bad.has(e.path) || !byPath.has(e.path)) { if (!byPath.has(e.path)) bad.add(e.path); continue; }
    const cur = next.has(e.path) ? next.get(e.path) : byPath.get(e.path);
    const at = e.find ? cur.indexOf(e.find) : -1;
    if (at < 0 || cur.indexOf(e.find, at + 1) >= 0) { bad.add(e.path); continue; }
    next.set(e.path, cur.slice(0, at) + e.replace + cur.slice(at + e.find.length));
  }
  const changedFiles = [];
  const broken = [];
  for (const [path, content] of next) {
    if (bad.has(path) || content === byPath.get(path)) continue;
    const checked = keepBalanced(byPath.get(path), content);
    if (checked == null) broken.push(path);
    else changedFiles.push({ path, content: checked });
  }
  return { files: changedFiles, skipped: [...bad].filter((p) => byPath.has(p)), broken };
}

const PAIRS = [["(", ")"], ["{", "}"], ["[", "]"]];
const count = (s, ch) => s.split(ch).length - 1;
const delta = (s, [open, close]) => count(s, open) - count(s, close);

// An edit must leave brackets as balanced as the file was before it. A stray
// closing parenthesis right before a declaration's semicolon (a common model
// slip: "...1)));") is repaired on the lines the edit wrote; anything else
// that does not balance returns null, and the file is left unchanged.
export function keepBalanced(before, after) {
  const off = () => PAIRS.map((p) => delta(after, p) - delta(before, p));
  let [paren, brace, bracket] = off();
  if (brace !== 0 || bracket !== 0) return null;
  if (paren === 0) return after;
  if (paren > 0) return null;
  const old = new Set(before.split("\n"));
  const lines = after.split("\n");
  for (let i = 0; i < lines.length && paren < 0; i++) {
    if (old.has(lines[i])) continue;
    while (paren < 0 && delta(lines[i], PAIRS[0]) < 0 && /\)\)\s*;/.test(lines[i])) {
      lines[i] = lines[i].replace(/\)(\s*;)(?![\s\S]*\)\s*;)/, "$1");
      paren++;
    }
  }
  return paren === 0 ? lines.join("\n") : null;
}

// Collect the text of a streamed Messages API response (server-sent events).
// Returns { text, stop }; a stream error event throws with an HTTP-like status.
export async function readMessageStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let stop = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") text += ev.delta.text;
      else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
      else if (ev.type === "error") {
        const err = new Error("anthropic stream " + (ev.error && ev.error.type));
        err.status = ev.error && ev.error.type === "overloaded_error" ? 529 : ev.error && ev.error.type === "rate_limit_error" ? 429 : 500;
        err.detail = JSON.stringify(ev.error || ev).slice(0, 300);
        throw err;
      }
    }
  }
  return { text, stop };
}
