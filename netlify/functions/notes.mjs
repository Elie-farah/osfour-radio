import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const hash = s => createHash("sha256").update(String(s)).digest("hex");
const clean = posts => (Array.isArray(posts) ? posts : []).slice(0, 50).map(p => ({
  name: String(p?.name || "").slice(0, 40),
  title: String(p?.title || "").slice(0, 100),
  text: String(p?.text || "").slice(0, 3000),
  at: Number(p?.at) || Date.now(),
})).filter(p => p.text && p.name);

export default async (req) => {
  const store = getStore({ name: "osfour-notebook", consistency: "strong" });
  if (req.method === "GET") {
    const { blobs } = await store.list();
    const out = [];
    for (const b of blobs) {
      const v = await store.get(b.key, { type: "json" });
      if (v && v.posts?.length) out.push({ id: b.key, posts: v.posts });
    }
    return Response.json(out, { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
    const { id, secret, posts } = body || {};
    if (!/^[a-z0-9]{16,40}$/.test(id || "") || typeof secret !== "string" || secret.length < 16)
      return new Response("Bad request", { status: 400 });
    const current = await store.get(id, { type: "json" });
    const isHost = process.env.HOST_KEY && req.headers.get("x-host-key") === process.env.HOST_KEY;
    if (current && current.h !== hash(secret) && !isHost) return new Response("Not yours", { status: 403 });
    await store.setJSON(id, { h: current?.h || hash(secret), posts: clean(posts) });
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/notes" };
