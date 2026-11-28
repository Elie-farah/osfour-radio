import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Tells listeners whether Osfour is live right now, and how to reach the host's microphone.
// Only the host can go live. The host key itself is never stored here, only its fingerprint.
const HOST_HASHES = ["4214e3afcef5a099e5a5d32120d615e662a7d4b165382276fe00f633b86f562d", "66cb755f9689b69840f709f129938c1873f86836af317c4ac54d258c2ad0e949"];   // the password, and the earlier host link
const isHost = req => { const k = req.headers.get("x-host-key") || ""; return !!k && HOST_HASHES.includes(createHash("sha256").update(k).digest("hex")); };
const FRESH = 45000;   // the host's page checks in every 15 seconds; if it stops, the live ends by itself

export default async (req) => {
  const store = getStore({ name: "osfour-live", consistency: "strong" });
  if (req.method === "GET") {
    const s = (await store.get("state", { type: "json" })) || {};
    const live = !!(s.peerId && s.beat && Date.now() - s.beat < FRESH);
    return Response.json(live ? { live, peerId: s.peerId, since: s.since } : { live: false }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "POST") {
    // slow down password guessing: after 8 wrong tries from one address, wait 15 minutes
    const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
    const fk = "fail2-" + createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const f = (await store.get(fk, { type: "json" })) || { n: 0, t: 0 };
    if (f.n >= 12 && Date.now() - f.t < 15 * 60000) return new Response("Too many tries, wait a little", { status: 429 });
    if (!isHost(req)) { await store.setJSON(fk, { n: (Date.now() - f.t < 15 * 60000 ? f.n : 0) + 1, t: Date.now() }); await new Promise(r => setTimeout(r, 800)); return new Response("Host only", { status: 403 }); }
    if (f.n) await store.delete(fk);
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
