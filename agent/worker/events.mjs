// Usage history. One D1 row per metered action (agent_events, migration 0008
// in transitions-pro), so the CRM can show who uses the Agent and how, beyond
// the monthly KV counters. Logging never blocks or fails a request: the write
// runs after the response via waitUntil, and errors are only logged.

export function logEvent(env, ctx, ev) {
  if (!env.DB) return;
  const email = ev.record?.email ? String(ev.record.email).toLowerCase() : null;
  const write = env.DB.prepare(
    `INSERT INTO agent_events (at, event, user_id, email, plan, mode, findings, files, score, status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    Date.now(), ev.event, ev.record?.user_id || null, email, ev.record?.plan || null,
    ev.mode || null, num(ev.findings), num(ev.files), num(ev.score), ev.status || null,
    ev.detail ? String(ev.detail).slice(0, 200) : null,
  ).run().catch((e) => console.error("[events] write failed:", e?.message));
  if (ctx?.waitUntil) ctx.waitUntil(write);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
