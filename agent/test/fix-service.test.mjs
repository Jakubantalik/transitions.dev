import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEdits, readMessageStream, keepBalanced } from "../worker/edits.mjs";
import { planBatch, withTokenFallbacks } from "../lib/fix.mjs";

test("edits apply in order, per file, all or nothing", () => {
  const files = [
    { path: "a.css", content: ".a { transition: all 300ms; }\n.b { color: red; }\n" },
    { path: "b.css", content: ".x { opacity: 0; }\n.x { opacity: 0; }\n" },
  ];
  const { files: out, skipped } = applyEdits(files, [
    { path: "a.css", find: "transition: all 300ms;", replace: "transition: opacity 250ms;" },
    { path: "a.css", find: "transition: opacity 250ms;", replace: "transition: opacity 150ms;" },
    { path: "b.css", find: ".x { opacity: 0; }", replace: ".x { opacity: 1; }" },
    { path: "ghost.css", find: "a", replace: "b" },
  ]);
  assert.deepEqual(out, [{ path: "a.css", content: ".a { transition: opacity 150ms; }\n.b { color: red; }\n" }]);
  assert.deepEqual(skipped, ["b.css"], "a find that matches twice leaves the file untouched");
});

test("a missing find leaves that whole file unchanged", () => {
  const { files, skipped } = applyEdits([{ path: "a.css", content: "one\ntwo\n" }], [
    { path: "a.css", find: "one", replace: "1" },
    { path: "a.css", find: "three", replace: "3" },
  ]);
  assert.deepEqual(files, []);
  assert.deepEqual(skipped, ["a.css"]);
});

const sse = (chunks) => new ReadableStream({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
});

test("the event stream is collected, split anywhere", async () => {
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const raw = [
    ev({ type: "message_start", message: {} }),
    ev({ type: "ping" }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"summary": "ok", ' } }),
    ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '"edits": []}' } }),
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
  ].join("");
  const parts = [raw.slice(0, 7), raw.slice(7, 101), raw.slice(101, 333), raw.slice(333)];
  assert.deepEqual(await readMessageStream(sse(parts)), { text: '{"summary": "ok", "edits": []}', stop: "end_turn" });
});

test("an overloaded event in the stream throws a 529", async () => {
  const raw = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`;
  await assert.rejects(readMessageStream(sse([raw])), (e) => e.status === 529);
});

test("a run takes the most important files first, within the size budget", () => {
  const root = mkdtempSync(join(tmpdir(), "ta-plan-"));
  mkdirSync(join(root, "src"));
  const file = (name, kb) => { writeFileSync(join(root, "src", name), "x".repeat(kb * 1000)); return "src/" + name; };
  const big = file("Huge.css", 150);
  const modal = file("Modal.css", 20);
  const card = file("Card.css", 50);
  const tiny = file("Tiny.css", 1);
  const plain = file("Plain.css", 70);
  const findings = [
    { path: big, severity: "major" },
    { path: modal, severity: "major" },
    { path: card, severity: "warn" },
    { path: tiny, severity: "minor" },
    { path: plain, severity: "info" },
  ];
  const plan = planBatch(root, findings, "polish", { budget: 75_000 });
  assert.deepEqual(plan.paths, [modal, card, tiny]);
  assert.deepEqual(plan.tooBig, [big]);
  assert.deepEqual(plan.remaining, [plain]);
  assert.equal(plan.remainingInfoOnly, 1);
});

test("tokens in a fix always carry their value as a fallback", () => {
  assert.equal(
    withTokenFallbacks("transition: opacity var(--duration-fast) var(--ease-smooth-out), transform var(--duration-quick, 150ms);"),
    "transition: opacity var(--duration-fast, 250ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)), transform var(--duration-quick, 150ms);",
  );
  assert.equal(withTokenFallbacks("color: var(--brand); transform: scale(var(--scale-medium));"), "color: var(--brand); transform: scale(var(--scale-medium, 0.97));");
});

test("an edit that breaks the brackets is repaired when it is a stray ')' or rejected", () => {
  const before = ".a { opacity: 0; transition: all 300ms; }\n";
  const slip = ".a { opacity: 0; transition: opacity 150ms var(--e, cubic-bezier(0.22, 1, 0.36, 1))); }\n";
  assert.equal(keepBalanced(before, slip), ".a { opacity: 0; transition: opacity 150ms var(--e, cubic-bezier(0.22, 1, 0.36, 1)); }\n");
  assert.equal(keepBalanced(before, ".a { opacity: 0; transition: opacity 150ms; \n"), null, "a lost brace is never patched");
  assert.equal(keepBalanced(before, ".a { transform: scale(var(--s, 0.9); }\n"), null, "a missing ')' is not guessed");
  const { files, broken } = applyEdits([{ path: "a.css", content: before }], [{ path: "a.css", find: "}", replace: "" }]);
  assert.deepEqual(files, []);
  assert.deepEqual(broken, ["a.css"]);
});

import http from "node:http";
import { readFileSync as readText } from "node:fs";
import { scan } from "../lib/scan.mjs";
import { runFix } from "../lib/fix.mjs";

const BUTTON = ".btn { padding: 8px; transition: all 300ms ease-in; }\n.btn:hover { background: #eee; box-shadow: 0 1px 2px #0002; }\n.btn.is-open { opacity: 1; }\n";

test('"transition: all" findings name exactly what the states change', () => {
  const root = mkdtempSync(join(tmpdir(), "ta-all-"));
  writeFileSync(join(root, "btn.css"), BUTTON);
  const f = scan(root).findings.find((x) => x.rule === "transition-all");
  assert.deepEqual(f.props.sort(), ["background", "box-shadow", "opacity"]);
  assert.match(f.message, /exactly the properties this element's states change: /);
});

test("a fix that would make a hover snap is put back, and the rest is kept", async () => {
  const root = mkdtempSync(join(tmpdir(), "ta-guard-"));
  writeFileSync(join(root, "btn.css"), BUTTON);
  writeFileSync(join(root, "card.css"), ".card { transition: all 900ms ease-in; }\n.card:hover { opacity: 0.9; }\n");
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        summary: "test",
        files: [
          { path: "btn.css", content: BUTTON.replace("transition: all 300ms ease-in;", "transition: opacity 250ms;") },
          { path: "card.css", content: ".card { transition: opacity 250ms ease-out; }\n.card:hover { opacity: 0.9; }\n" },
        ],
        usage: { used: 1, quota: 10 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  const report = {};
  const log = console.log;
  console.log = () => {};
  try {
    await runFix(root, scan(root), { api: `http://127.0.0.1:${server.address().port}`, license: "test", yes: true, pr: false, mode: "polish", report });
  } finally {
    console.log = log;
    server.close();
  }
  assert.equal(readText(join(root, "btn.css"), "utf8"), BUTTON, "the button keeps its old transition rather than a snapping hover");
  assert.match(readText(join(root, "card.css"), "utf8"), /transition: opacity 250ms ease-out/);
  assert.deepEqual(report.reverted, ["btn.css"]);
  assert.deepEqual(report.applied, ["card.css"]);
});
