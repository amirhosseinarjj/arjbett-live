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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalize(code, m) {
  const ft = m.score?.fullTime || {};
  const fin = m.status === "FINISHED" &&
    ft.home != null && ft.away != null;

  return {
    d: (m.utcDate || "").slice(0, 10),
    lg: code,
    h: m.homeTeam?.shortName || m.homeTeam?.name || "?",
    a: m.awayTeam?.shortName || m.awayTeam?.name || "?",
    hg: fin ? ft.home : null,
    ag: fin ? ft.away : null,
    fin,
    status: m.status || null,
    md: m.matchday || null,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/matches") {
      if (request.method !== "GET") {
        return json({ detail: "Method not allowed" }, 405);
      }

      const code = url.searchParams.get("competition") || "PL";

      if (!COMPETITIONS[code]) {
        return json({ detail: "لیگ نامعتبر است." }, 400);
      }

      if (!env.FOOTBALL_DATA_API_KEY) {
        return json({
          detail: "کلید API تنظیم نشده است."
        }, 503);
      }

      try {
        const response = await fetch(
          `https://api.football-data.org/v4/competitions/${code}/matches`,
          {
            headers: {
              "X-Auth-Token": env.FOOTBALL_DATA_API_KEY
            }
          }
        );

        if (!response.ok) {
          return json({
            detail: `خطای منبع داده (${response.status}).`
          }, response.status === 429 ? 429 : 502);
        }

        const data = await response.json();

        return json({
          competition: code,
          name: COMPETITIONS[code],
          season: data.filters?.season || null,
          updated: new Date().toISOString(),
          matches: (data.matches || []).map(
            m => normalize(code, m)
          )
        });

      } catch (error) {
        return json({
          detail: "اتصال به منبع داده برقرار نشد."
        }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
