// Gives the browsers a relay (TURN) server, so the live voice reaches people on any network, not only the same Wi-Fi.
// Set in Netlify > Site configuration > Environment variables:
//   CF_TURN_KEY_ID and CF_TURN_TOKEN  (Cloudflare Realtime TURN key), or
//   METERED_APP and METERED_KEY       (metered.ca TURN app name and API key)
const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async () => {
  const env = (k) => (globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? "").trim();
  try {
    if (env("CF_TURN_KEY_ID") && env("CF_TURN_TOKEN")) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env("CF_TURN_KEY_ID")}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: "Bearer " + env("CF_TURN_TOKEN"), "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }) });
      if (r.ok) { const d = await r.json(); const s = [].concat(d.iceServers || []); if (s.length) return json({ iceServers: STUN.concat(s), relay: "cloudflare" }); }
    }
    if (env("METERED_APP") && env("METERED_KEY")) {
      const app = env("METERED_APP").replace(/\.metered\.live$/, "");
      const r = await fetch(`https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(env("METERED_KEY"))}`);
      if (r.ok) { const s = await r.json(); if (Array.isArray(s) && s.length) return json({ iceServers: STUN.concat(s), relay: "metered" }); }
    }
  } catch (e) {}
  return json({ iceServers: STUN, relay: null });
};
export const config = { path: "/api/turn" };
