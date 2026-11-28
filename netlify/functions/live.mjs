import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Tells listeners whether Osfour is live right now, and how to reach the host's microphone.
// Only the host can go live. The host key itself is never stored here, only its fingerprint.
const HOST_HASH = "66cb755f9689b69840f709f129938c1873f86836af317c4ac54d258c2ad0e949";
const isHost = req => { const k = req.headers.get("x-host-key") || ""; return !!k && createHash("sha256").update(k).digest("hex") === HOST_HASH; };
const FRESH = 45000;   // the host's page checks in every 15 seconds; if it stops, the live ends by itself

export default async (req) => {
  const store = getStore({ name: "osfour-live", consistency: "strong" });
  if (req.method === "GET") {
    const s = (await store.get("state", { type: "json" })) || {};
    const live = !!(s.peerId && s.beat && Date.now() - s.beat < FRESH);
    return Response.json(live ? { live, peerId: s.peerId, since: s.since } : { live: false }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "POST") {
    if (!isHost(req)) return new Response("Host only", { status: 403 });
    let b; try { b = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (b && b.check) return Response.json({ ok: true });
    if (!b || !b.live) { await store.setJSON("state", {}); return Response.json({ ok: true, live: false }); }
    const peerId = String(b.peerId || "");
    if (!/^[A-Za-z0-9-]{6,64}$/.test(peerId)) return new Response("Bad id", { status: 400 });
    const s = (await store.get("state", { type: "json" })) || {};
    const since = s.peerId === peerId && s.since ? s.since : Date.now();
    await store.setJSON("state", { peerId, since, beat: Date.now() });
    return Response.json({ ok: true, live: true });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/live" };
