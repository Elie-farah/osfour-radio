import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// The live voice travels through the site itself: the host's page uploads a short piece of audio every few seconds,
// and every listener's page downloads the pieces in order. Works on any network, no relay server or extra account needed.
const HOST_HASHES = ["4214e3afcef5a099e5a5d32120d615e662a7d4b165382276fe00f633b86f562d", "66cb755f9689b69840f709f129938c1873f86836af317c4ac54d258c2ad0e949"];
const isHost = req => { const k = req.headers.get("x-host-key") || ""; return !!k && HOST_HASHES.includes(createHash("sha256").update(k).digest("hex")); };
const okId = s => /^[A-Za-z0-9-]{6,64}$/.test(s || "");
const KEEP = 20;   // pieces kept on the server (about a minute)

export default async (req) => {
  const store = getStore({ name: "osfour-live", consistency: "strong" });
  const url = new URL(req.url);
  const nc = { "cache-control": "no-store" };
  if (req.method === "POST") {
    if (!isHost(req)) return new Response("Host only", { status: 403 });
    const s = url.searchParams.get("s"), n = parseInt(url.searchParams.get("n"), 10);
    if (!okId(s) || !(n >= 0)) return new Response("Bad request", { status: 400 });
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 2_000_000) return new Response("Bad size", { status: 400 });
    const type = (req.headers.get("content-type") || "audio/webm").slice(0, 80);
    await store.set(`seg-${s}-${n}`, buf, { metadata: { type } });
    const st = (await store.get("state", { type: "json" })) || {};
    if (st.peerId === s) await store.setJSON("state", { ...st, seq: n, beat: Date.now() });
    if (n >= KEEP) store.delete(`seg-${s}-${n - KEEP}`).catch(() => {});
    const ls = (await store.get("listeners", { type: "json" })) || {};
    const now = Date.now(); const count = Object.values(ls).filter(t => now - t < 20000).length;
    return Response.json({ ok: true, listeners: count }, { headers: nc });
  }
  if (req.method === "GET") {
    const s = url.searchParams.get("s"), n = parseInt(url.searchParams.get("n"), 10), l = url.searchParams.get("l");
    if (!okId(s) || !(n >= 0)) return new Response("Bad request", { status: 400 });
    const r = await store.getWithMetadata(`seg-${s}-${n}`, { type: "arrayBuffer" });
    if (!r) return new Response(null, { status: 204, headers: nc });
    if (okId(l)) {   // count who is listening, for the host
      const ls = (await store.get("listeners", { type: "json" })) || {}; const now = Date.now();
      for (const k in ls) if (now - ls[k] > 20000) delete ls[k];
      ls[l] = now; await store.setJSON("listeners", ls);
    }
    return new Response(r.data, { headers: { ...nc, "content-type": r.metadata?.type || "audio/webm" } });
  }
  return new Response("Method not allowed", { status: 405 });
};
export const config = { path: "/api/seg" };
