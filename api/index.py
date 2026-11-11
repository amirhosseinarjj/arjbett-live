"""ARJBETT backend: real match data from football-data.org + static frontend."""
import os
import time
import asyncio
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

API = "https://api.football-data.org/v4"
KEY = os.getenv("FOOTBALL_DATA_API_KEY", "")
TTL = 600  # seconds; keeps us under the free 10 requests/minute limit

COMPETITIONS = {
    "PL": "Premier League",
    "PD": "La Liga",
    "SA": "Serie A",
    "BL1": "Bundesliga",
    "FL1": "Ligue 1",
    "DED": "Eredivisie",
    "PPL": "Primeira Liga",
    "ELC": "Championship",
}

app = FastAPI(title="ARJBETT API")
_cache: dict = {}
_lock = asyncio.Lock()


def normalize(code: str, m: dict) -> dict:
    ft = (m.get("score") or {}).get("fullTime") or {}
    hg, ag = ft.get("home"), ft.get("away")
    fin = m.get("status") == "FINISHED" and hg is not None and ag is not None
    return {
        "d": (m.get("utcDate") or "")[:10],
        "lg": code,
        "h": (m.get("homeTeam") or {}).get("shortName") or (m.get("homeTeam") or {}).get("name") or "?",
        "a": (m.get("awayTeam") or {}).get("shortName") or (m.get("awayTeam") or {}).get("name") or "?",
        "hg": hg if fin else None,
        "ag": ag if fin else None,
        "fin": fin,
        "status": m.get("status"),
        "md": m.get("matchday"),
    }


async def get_matches(code: str) -> dict:
    now = time.time()
    hit = _cache.get(code)
    if hit and now - hit["t"] < TTL:
        return hit["data"]
    if not KEY:
        raise HTTPException(503, "کلید API تنظیم نشده است (FOOTBALL_DATA_API_KEY).")
    async with _lock:
        hit = _cache.get(code)
        if hit and time.time() - hit["t"] < TTL:
            return hit["data"]
        try:
            async with httpx.AsyncClient(timeout=25) as c:
                r = await c.get(f"{API}/competitions/{code}/matches", headers={"X-Auth-Token": KEY})
        except httpx.HTTPError:
            if hit:
                return hit["data"]
            raise HTTPException(502, "اتصال به منبع داده برقرار نشد.")
        if r.status_code == 429:
            if hit:
                return hit["data"]
            raise HTTPException(429, "سقف درخواست منبع داده پر شد؛ یک دقیقه بعد دوباره تلاش کن.")
        if r.status_code in (401, 403):
            raise HTTPException(502, "کلید API نامعتبر است یا به این لیگ دسترسی ندارد.")
        if r.status_code != 200:
            if hit:
                return hit["data"]
            raise HTTPException(502, f"خطای منبع داده ({r.status_code}).")
        j = r.json()
        data = {
            "competition": code,
            "name": COMPETITIONS[code],
            "season": (j.get("filters") or {}).get("season"),
            "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "matches": [normalize(code, m) for m in j.get("matches", [])],
        }
        _cache[code] = {"t": time.time(), "data": data}
        return data


router = APIRouter()


@router.get("/health")
def health():
    return {"ok": True, "key_set": bool(KEY)}


@router.get("/matches")
async def matches(competition: str = Query("PL")):
    if competition not in COMPETITIONS:
        raise HTTPException(400, "لیگ نامعتبر است.")
    return await get_matches(competition)


# Works whether Vercel passes the original path (/api/...) or a rewritten one.
app.include_router(router, prefix="/api")
app.include_router(router)

# Local run only: Vercel serves /public by itself.
_pub = Path(__file__).resolve().parent.parent / "public"
if os.getenv("VERCEL") is None and _pub.exists():
    app.mount("/", StaticFiles(directory=_pub, html=True), name="static")
