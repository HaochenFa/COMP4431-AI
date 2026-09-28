"""Download each trail's official AFCD photo (hero + thumbnail) from its hiking.gov.hk page.

    uv --project backend run python scripts/fetch_photos.py [--force]

Writes data/photos/<id>.jpg (about 1620x1080) and data/photos/thumb/<id>.jpg (480x320). The page's
og:image is the hero; the site keeps a 480px thumbnail under /thumb/ with the same file name. Photos are
AFCD's (watermarked); the app credits them. Trails without a page or photo fall back to route art.
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PHOTOS = DATA / "photos"
SITE = "https://www.hiking.gov.hk/"
OG_IMAGE = re.compile(r'<meta property="og:image" content="([^"]+)"')


def photo_url(page: str) -> str | None:
    if not (m := OG_IMAGE.search(page)):
        return None
    url = html.unescape(m.group(1))
    if url.startswith("./"):
        url = SITE + url[2:]
    elif url.startswith("/"):
        url = SITE + url[1:]
    return url if "/uploads/trail/" in url else None  # skip the site-wide default image


def save(client: httpx.Client, url: str, path: Path) -> bool:
    r = client.get(url)
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        return False
    path.write_bytes(r.content)
    return True


def main() -> int:
    force = "--force" in sys.argv
    (PHOTOS / "thumb").mkdir(parents=True, exist_ok=True)
    trails = json.loads((DATA / "trails.json").read_text())
    got = 0
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        for t in trails:
            hero, thumb = PHOTOS / f"{t['id']}.jpg", PHOTOS / "thumb" / f"{t['id']}.jpg"
            if not t.get("url") or (hero.exists() and thumb.exists() and not force):
                got += hero.exists()
                continue
            try:
                url = photo_url(client.get(t["url"]).text)
                if url and save(client, url, hero):
                    save(client, url.replace("/watermark/", "/thumb/"), thumb)
                    got += 1
                    print(f"  {t['id']:<8} {url.rsplit('/', 1)[-1]}")
                else:
                    print(f"  {t['id']:<8} no photo")
            except httpx.HTTPError as e:
                print(f"  ! {t['id']}: {e}", file=sys.stderr)
            time.sleep(0.3)  # be polite to hiking.gov.hk
    print(f"{got}/{len(trails)} trails have a photo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
