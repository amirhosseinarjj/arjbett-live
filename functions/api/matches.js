// ARJBETT: Cloudflare Pages Function. Fetches real match data from football-data.org.
// Secret key is read from the environment variable FOOTBALL_DATA_API_KEY (never put it in code).
const COMPETITIONS = {
  PL: "Premier League",
  PD: "La Liga",
  SA: "Serie A",
  BL1: "Bundesliga",
  FL1: "Ligue 1",
  DED: "Eredivisie",
  PPL: "Primeira Liga",
  ELC: "Championship",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

function normalize(code, m) {
  const ft = (m.score && m.score.fullTime) || {};
  const hg = ft.home;
  const ag = ft.away;
  const fin = m.status === "FINISHED" && hg != null && ag != null;
  const h = m.homeTeam || {};
  const a = m.awayTeam || {};
  return {
    d: (m.utcDate || "").slice(0, 10),
    lg: code,
    h: h.shortName || h.name || "?",
    a: a.shortName || a.name || "?",
    hg: fin ? hg : null,
    ag: fin ? ag : null,
    fin,
    status: m.status || null,
    md: m.matchday || null,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("competition") || "PL";
  if (!COMPETITIONS[code]) return json({ detail: "لیگ نامعتبر است." }, 400);
  if (!env.FOOTBALL_DATA_API_KEY) {
    return json({ detail: "کلید API تنظیم نشده است (FOOTBALL_DATA_API_KEY)." }, 503);
  }
  let r;
  try {
    r = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches`, {
      headers: { "X-Auth-Token": env.FOOTBALL_DATA_API_KEY },
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 600, "400-599": 0 } },
    });
  } catch (e) {
    return json({ detail: "اتصال به منبع داده برقرار نشد." }, 502);
  }
  if (r.status === 429) return json({ detail: "سقف درخواست منبع داده پر شد؛ یک دقیقه بعد دوباره تلاش کن." }, 429);
  if (r.status === 401 || r.status === 403) return json({ detail: "کلید API نامعتبر است یا به این لیگ دسترسی ندارد." }, 502);
  if (!r.ok) return json({ detail: `خطای منبع داده (${r.status}).` }, 502);
  const j = await r.json();
  return json(
    {
      competition: code,
      name: COMPETITIONS[code],
      season: (j.filters && j.filters.season) || null,
      updated: new Date().toISOString(),
      matches: (j.matches || []).map((m) => normalize(code, m)),
    },
    200,
    { "cache-control": "public, max-age=60" }
  );
}
