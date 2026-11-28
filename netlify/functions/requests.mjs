import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Song requests: a visitor writes a song, the site finds it on YouTube and queues it.
// Everyone hears the requests in the order they came, right after the current one, then the normal schedule continues.
const HOST_HASHES = ["4214e3afcef5a099e5a5d32120d615e662a7d4b165382276fe00f633b86f562d", "66cb755f9689b69840f709f129938c1873f86836af317c4ac54d258c2ad0e949"];
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const isHost = req => { const k = req.headers.get("x-host-key") || ""; return !!k && HOST_HASHES.includes(sha(k)); };
const MAX_QUEUE = 10, MIN_DUR = 90, MAX_DUR = 600, GAP = 2000, LEAD = 15000;
const nc = { "cache-control": "no-store" };
const beirutHour = () => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", hour: "2-digit", hourCycle: "h23" }).format(new Date());
const YT_HEADERS = { "accept-language": "en-US,en;q=0.9,ar;q=0.8", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", cookie: "CONSENT=YES+1; SOCS=CAI" };

function parseResults(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
  if (!m) return [];
  let d; try { d = JSON.parse(m[1]); } catch { return []; }
  const out = [];
  const walk = o => {
    if (!o || typeof o !== "object" || out.length > 25) return;
    if (o.videoRenderer) {
      const v = o.videoRenderer, L = v.lengthText?.simpleText || "";
      const sec = L.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
      if (v.videoId && sec) out.push({ vid: v.videoId, dur: sec, title: (v.title?.runs || []).map(r => r.text).join("") });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(d); return out;
}
async function embeddable(vid) {
  try {
    const t = await fetch("https://www.youtube.com/watch?v=" + vid, { headers: YT_HEADERS }).then(r => r.text());
    const ok = /"playableInEmbed":true/.test(t) && /"playabilityStatus":\{"status":"OK"/.test(t);
    const len = +((t.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0);
    return ok ? len : 0;
  } catch { return 0; }
}
async function findSong(q) {
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
  const html = await fetch(url, { headers: YT_HEADERS }).then(r => r.text());
  const list = parseResults(html).filter(v => v.dur >= MIN_DUR && v.dur <= MAX_DUR && !/(\bmix\b|playlist|full album|كوكتيل|ساعة|البوم كامل)/i.test(v.title));
  for (const v of list.slice(0, 5)) { const len = await embeddable(v.vid); if (len) return { ...v, dur: len }; }
  return null;
}
// times each waiting request so they play back to back, the first one shortly after now
function retime(q, now) {
  let t = now + LEAD;
  for (const r of q) {
    if (r.start <= now) { t = Math.max(t, r.start + r.dur * 1000 + GAP); continue; }   // already playing: keep it
    r.start = t; t = r.start + r.dur * 1000 + GAP;
  }
  return q;
}
const live = (q, now) => q.filter(r => r.start + r.dur * 1000 > now);
const pub = q => q.map(({ id, vid, title, dur, name, start }) => ({ id, vid, title, dur, name, start }));

export default async (req) => {
  const store = getStore({ name: "osfour-requests", consistency: "strong" });
  const now = Date.now();
  let q = live((await store.get("queue", { type: "json" })) || [], now);
  if (req.method === "GET") return Response.json({ queue: pub(q), now }, { headers: nc });

  if (req.method === "DELETE") {
    if (!isHost(req)) return new Response("Host only", { status: 403 });
    const id = new URL(req.url).searchParams.get("id");
    q = retime(q.filter(r => r.id !== id), now);
    await store.setJSON("queue", q);
    return Response.json({ queue: pub(q), now }, { headers: nc });
  }

  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return Response.json({ error: "Please try again." }, { status: 400 }); }
    const song = String(b?.song || "").replace(/\s+/g, " ").trim().slice(0, 100);
    const name = String(b?.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (song.length < 2 || !name) return Response.json({ error: "Write the song and your name." }, { status: 400 });
    const h = beirutHour(); if (h < 6) return Response.json({ error: "The radio is resting until 6 AM. Ask again in the morning!" }, { status: 409 });
    if (q.length >= MAX_QUEUE) return Response.json({ error: "The list is full right now. Try again in a few minutes." }, { status: 429 });
    const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
    const who = sha("osfour-req:" + ip).slice(0, 16);
    if (!isHost(req) && q.some(r => r.who === who && r.start > now)) return Response.json({ error: "Your song is already waiting. You can ask for another once it plays." }, { status: 429 });
    let hit = null; try { hit = await findSong(song); } catch {}
    if (!hit) return Response.json({ error: "We couldn't find that song. Try writing the singer and the song name." }, { status: 404 });
    if (q.some(r => r.vid === hit.vid)) return Response.json({ error: "That song is already in the list." }, { status: 409 });
    const r = { id: sha(now + ":" + hit.vid + ":" + who).slice(0, 12), vid: hit.vid, title: hit.title.slice(0, 90), dur: hit.dur, name, who, asked: song, start: 0 };
    r.start = now + 864e5; q.push(r); q = retime(q, now);   // a new request always goes after all the others
    await store.setJSON("queue", q);
    return Response.json({ ok: true, item: pub([q.find(x => x.id === r.id)])[0], queue: pub(q), now }, { headers: nc });
  }
  return new Response("Method not allowed", { status: 405 });
};
export const config = { path: "/api/requests" };
