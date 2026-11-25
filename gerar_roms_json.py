#!/usr/bin/env python3
"""
Gera automaticamente roms.json a partir de:
  1. Pastas de consoles presentes neste repositório (ex.: nes/, snes/, gba/)
  2. GitHub Releases deste repositório, cujas tags correspondam a um console
     (ex.: dreamcast, n64, nds, gba, megadrive-1, gbc-2, etc.)

Cada console vira uma categoria na Loja de Jogos do HUB STORE e instala em /roms/<sistema>/.
"""
import datetime
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from urllib.parse import quote

REPO = os.environ.get("GITHUB_REPOSITORY", "AlexTayron/roms-games")
BRANCH = os.environ.get("GITHUB_REF_NAME", "main")
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/"
API_BASE = f"https://api.github.com/repos/{REPO}"

SYSTEM_NAMES = {
    "3do": "3DO", "amiga": "Amiga", "amigacd32": "Amiga CD32", "amstradcpc": "Amstrad CPC",
    "apple2": "Apple II", "arcade": "Arcade", "atari2600": "Atari 2600", "atari5200": "Atari 5200",
    "atari7800": "Atari 7800", "atari800": "Atari 800", "atarijaguar": "Atari Jaguar",
    "atarilynx": "Atari Lynx", "atarist": "Atari ST", "atomiswave": "Atomiswave",
    "c64": "Commodore 64", "coleco": "ColecoVision", "cps1": "CPS-1 (Arcade)",
    "cps2": "CPS-2 (Arcade)", "cps3": "CPS-3 (Arcade)", "daphne": "Daphne", "dos": "DOS",
    "dreamcast": "Dreamcast", "easyrpg": "EasyRPG", "famicom": "Famicom", "fbneo": "Arcade (FBNeo)",
    "fds": "Famicom Disk System", "gameandwatch": "Game & Watch", "gamegear": "Game Gear",
    "gb": "Game Boy", "gba": "Game Boy Advance", "gbc": "Game Boy Color", "genesis": "Sega Genesis",
    "intellivision": "Intellivision", "mame": "MAME", "mame2003": "MAME 2003",
    "mastersystem": "Master System", "megadrive": "Mega Drive", "msx": "MSX", "msx2": "MSX2",
    "n64": "Nintendo 64", "n64dd": "Nintendo 64DD", "naomi": "Naomi", "nds": "Nintendo DS",
    "neogeo": "Neo Geo", "neogeocd": "Neo Geo CD", "nes": "NES", "ngp": "Neo Geo Pocket",
    "ngpc": "Neo Geo Pocket Color", "odyssey2": "Odyssey 2", "openbor": "OpenBOR",
    "pcengine": "PC Engine", "pcenginecd": "PC Engine CD", "pcfx": "PC-FX", "pico": "Sega Pico",
    "pico-8": "PICO-8", "pokemini": "Pokemon Mini", "psp": "PSP", "psx": "PlayStation (PSX)",
    "saturn": "Sega Saturn", "scummvm": "ScummVM", "sega32x": "Sega 32X", "segacd": "Sega CD",
    "sg-1000": "SG-1000", "sgb": "Super Game Boy", "snes": "Super Nintendo (SNES)",
    "supergrafx": "SuperGrafx", "vectrex": "Vectrex", "virtualboy": "Virtual Boy",
    "wonderswan": "WonderSwan", "wonderswancolor": "WonderSwan Color",
}

ALIASES = {
    "ps1": "psx", "playstation": "psx", "ps": "psx", "psone": "psx",
    "md": "megadrive", "mega_drive": "megadrive", "mega-drive": "megadrive", "genesis": "megadrive",
    "sms": "mastersystem", "master_system": "mastersystem", "master-system": "mastersystem",
    "gg": "gamegear", "game_gear": "gamegear", "game-gear": "gamegear",
    "sfc": "snes", "super_nintendo": "snes", "super-nintendo": "snes", "supernintendo": "snes",
    "fc": "nes", "famicom": "nes", "gameboy": "gb", "game_boy": "gb", "game-boy": "gb",
    "gameboycolor": "gbc", "game_boy_color": "gbc", "game-boy-color": "gbc",
    "gameboyadvance": "gba", "game_boy_advance": "gba", "game-boy-advance": "gba",
    "nintendo64": "n64", "nintendo_64": "n64", "ds": "nds", "nintendo_ds": "nds",
    "dc": "dreamcast", "pce": "pcengine", "tg16": "pcengine", "fba": "arcade", "fbneo": "arcade",
    "lynx": "atarilynx", "atari": "atari2600", "2600": "atari2600", "5200": "atari5200",
    "7800": "atari7800", "32x": "sega32x", "scd": "segacd", "megacd": "segacd",
    "ws": "wonderswan", "wsc": "wonderswancolor", "vb": "virtualboy", "pico8": "pico-8",
}

NON_GAME_EXT = {
    "md", "txt", "nfo", "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico",
    "json", "xml", "yml", "yaml", "sh", "py", "lua", "js", "mjs", "css", "html", "htm",
    "pdf", "ini", "cfg", "conf", "log",
    # Saves e metadados de emuladores
    "srm", "state", "rtc", "brm", "old", "sav", "nv", "eep", "fla", "mpk", "mcr", "vmu",
    "mp4", "avi", "mkv", "mov", "webm", "db", "ds_store",
}
IMG_EXT = ("png", "jpg", "jpeg")

IGNORED_SUBDIRS = {
    "images", "downloaded_images", "downloaded_videos", "media", "default_images",
    "cheats", "savestates", "slot2", "backup", "logs_arrm", "gpsp", "genesis plus gx",
}


def slug(text):
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "jogo"


def is_non_game_file(fname):
    fl = fname.lower()
    if fl.startswith(".") or fl.startswith("readme") or fl.startswith("license") or fl.startswith("gamelist"):
        return True
    # Saves de VMU do Dreamcast (ex.: Crazy Taxi 2.A1.bin)
    if re.search(r"\.a[12]\.bin$", fl):
        return True
    ext = fl.rsplit(".", 1)[-1] if "." in fl else ""
    return ext in NON_GAME_EXT or not ext


def resolve_system(label):
    if not label:
        return None
    raw = label.strip().lower()
    key = re.sub(r"\s+", "_", raw)
    key = ALIASES.get(key, key)
    if key in SYSTEM_NAMES:
        return key

    # Tenta remover sufixos de lote em tags de release (ex.: gba-1, megadrive-part2, gbc-covers)
    trimmed = re.sub(r"[-_](?:part|parte|p|lote|vol|v)?\d+$", "", raw)
    trimmed = re.sub(r"[-_](?:covers|capas|media|roms|ptbr|pt-br)$", "", trimmed)
    trimmed_key = ALIASES.get(trimmed, trimmed)
    if trimmed_key in SYSTEM_NAMES:
        return trimmed_key

    norm = " " + re.sub(r"[^a-z0-9]+", " ", raw) + " "
    for k in sorted(ALIASES, key=len, reverse=True):
        if f" {k.replace('_', ' ').replace('-', ' ')} " in norm:
            return ALIASES[k]
    for k in sorted(SYSTEM_NAMES, key=len, reverse=True):
        if f" {k.replace('-', ' ')} " in norm:
            return k
    return None


def parse_cover_key(stem):
    """Retorna (slug_do_jogo, prioridade) ou None para imagens que não são capa (ex.: marquee)."""
    low = stem.lower()
    if low.endswith("-marquee"):
        return None
    for suffix, prio in (
        ("-boxfront", 1),
        ("-box2dfront", 1),
        ("-cover", 1),
        ("-image", 2),
        ("-thumb", 3),
    ):
        if low.endswith(suffix):
            return slug(stem[:-len(suffix)]), prio
    return slug(stem), 0


def register_cover(cover_map, stem, url):
    parsed = parse_cover_key(stem)
    if not parsed:
        return
    key, prio = parsed
    prev = cover_map.get(key)
    if prev is None or prio < prev[0]:
        cover_map[key] = (prio, url)


def fetch_github_releases():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    releases = []
    page = 1
    while True:
        url = f"{API_BASE}/releases?per_page=100&page={page}"
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "HUB-STORE-roms-indexer",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                batch = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return []
            raise
        if not batch:
            break
        releases.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return releases


def scan_local_repo(root, seen_ids, seen_urls):
    games = []
    # Primeiro mapeia capas por sistema (incluindo subpastas images/ e downloaded_images/)
    local_covers = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            continue
        segs = rel_dir.split("/")
        sys_id = resolve_system(segs[0])
        if not sys_id:
            continue
        sys_covers = local_covers.setdefault(sys_id, {})
        for fname in sorted(filenames):
            ext = fname.lower().rsplit(".", 1)[-1] if "." in fname else ""
            if ext in IMG_EXT:
                stem = fname.rsplit(".", 1)[0]
                url = RAW_BASE + quote(f"{rel_dir}/{fname}", safe="/")
                register_cover(sys_covers, stem, url)

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".") and d.lower() not in IGNORED_SUBDIRS
        )
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            continue
        segs = rel_dir.split("/")
        sys_id = resolve_system(segs[0])
        if not sys_id:
            continue

        sys_covers = local_covers.get(sys_id, {})
        for fname in sorted(filenames):
            if is_non_game_file(fname):
                continue
            full = os.path.join(dirpath, fname)
            rel_path = f"{rel_dir}/{fname}"
            download_url = RAW_BASE + quote(rel_path, safe="/")
            if download_url in seen_urls:
                continue
            seen_urls.add(download_url)

            ext = fname.lower().rsplit(".", 1)[-1] if "." in fname else ""
            clean = fname.rsplit(".", 1)[0] if "." in fname else fname
            base_id = f"{sys_id}_{slug(clean)}"
            gid = base_id
            k = 2
            while gid in seen_ids:
                gid = f"{base_id}_{k}"
                k += 1
            seen_ids.add(gid)

            cover_entry = sys_covers.get(slug(clean))
            item = {
                "id": gid,
                "name": clean,
                "system": sys_id,
                "section": "roms",
                "install_mode": "file",
                "filename": fname,
                "file_type": ext.upper(),
                "size": os.path.getsize(full),
                "download_url": download_url,
                "description": f"{SYSTEM_NAMES.get(sys_id, sys_id.upper())} • {fname}",
                "source": REPO,
            }
            if cover_entry:
                item["cover"] = cover_entry[1]
            games.append(item)
    return games


def scan_github_releases(seen_ids, seen_urls):
    require_releases = os.environ.get("REQUIRE_RELEASES", "0") == "1"
    try:
        releases = fetch_github_releases()
    except Exception as exc:
        if require_releases:
            raise
        print(f"Aviso: não foi possível consultar GitHub Releases ({exc}).", file=sys.stderr)
        return []

    # Agrupa releases publicadas por sistema
    parsed_releases = []
    release_covers = {}
    for rel in releases:
        if rel.get("draft"):
            continue
        tag = rel.get("tag_name") or ""
        sys_id = resolve_system(tag) or resolve_system(rel.get("name") or "")
        if not sys_id:
            continue
        assets = rel.get("assets") or []
        parsed_releases.append((sys_id, tag, assets))
        sys_covers = release_covers.setdefault(sys_id, {})
        for asset in assets:
            orig_name = (asset.get("label") or "").strip() or asset.get("name") or ""
            ext = orig_name.lower().rsplit(".", 1)[-1] if "." in orig_name else ""
            if ext in IMG_EXT:
                stem = orig_name.rsplit(".", 1)[0]
                register_cover(sys_covers, stem, asset["browser_download_url"])
                # Também registra pelo nome sanitizado caso label difira
                raw_name = asset.get("name") or ""
                if raw_name and "." in raw_name:
                    register_cover(sys_covers, raw_name.rsplit(".", 1)[0], asset["browser_download_url"])

    games = []
    for sys_id, _tag, assets in parsed_releases:
        sys_covers = release_covers.get(sys_id, {})
        for asset in sorted(assets, key=lambda a: ((a.get("label") or a.get("name") or "").lower())):
            orig_name = (asset.get("label") or "").strip() or asset.get("name") or ""
            if is_non_game_file(orig_name):
                continue
            download_url = asset.get("browser_download_url") or ""
            if not download_url or download_url in seen_urls:
                continue
            seen_urls.add(download_url)

            ext = orig_name.lower().rsplit(".", 1)[-1] if "." in orig_name else ""
            clean = orig_name.rsplit(".", 1)[0] if "." in orig_name else orig_name
            base_id = f"{sys_id}_{slug(clean)}"
            gid = base_id
            k = 2
            while gid in seen_ids:
                gid = f"{base_id}_{k}"
                k += 1
            seen_ids.add(gid)

            cover_entry = sys_covers.get(slug(clean))
            if not cover_entry:
                raw_name = asset.get("name") or ""
                if "." in raw_name:
                    cover_entry = sys_covers.get(slug(raw_name.rsplit(".", 1)[0]))

            item = {
                "id": gid,
                "name": clean,
                "system": sys_id,
                "section": "roms",
                "install_mode": "file",
                "filename": orig_name,
                "file_type": ext.upper(),
                "size": int(asset.get("size") or 0),
                "download_url": download_url,
                "description": f"{SYSTEM_NAMES.get(sys_id, sys_id.upper())} • {orig_name}",
                "source": REPO,
            }
            if cover_entry:
                item["cover"] = cover_entry[1]
            games.append(item)
    return games


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    seen_ids = set()
    seen_urls = set()

    games = []
    # Em GitHub Actions (repo limpo) ou local: indexa pastas rastreadas no repo + GitHub Releases
    if os.environ.get("SKIP_LOCAL_SCAN", "0") != "1":
        games.extend(scan_local_repo(root, seen_ids, seen_urls))
    games.extend(scan_github_releases(seen_ids, seen_urls))

    games.sort(key=lambda g: (g["system"], g["name"].lower(), g["id"]))

    payload = {
        "catalog_version": 1,
        "title": "HUB STORE - Loja de Jogos",
        "updated": datetime.date.today().isoformat(),
        "games": games,
    }
    out_path = os.path.join(root, "roms.json")
    with open(out_path, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    print(f"roms.json gerado com {len(games)} jogo(s).")


if __name__ == "__main__":
    main()
