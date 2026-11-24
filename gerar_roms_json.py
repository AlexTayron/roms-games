#!/usr/bin/env python3
"""
Gera automaticamente roms.json a partir das pastas de consoles deste repositório.
Cada pasta (ex.: nes/, snes/, gba/, psx/, psp/, atari2600/, megadrive/, arcade/)
vira uma categoria na Loja de Jogos do HUB STORE e instala em /roms/<sistema>/.
"""
import datetime
import json
import os
import re
import unicodedata
from urllib.parse import quote

REPO = os.environ.get("GITHUB_REPOSITORY", "AlexTayron/roms-games")
BRANCH = os.environ.get("GITHUB_REF_NAME", "main")
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/"

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
    "json", "xml", "yml", "yaml", "sh", "py", "lua", "js", "css", "html", "htm",
    "pdf", "ini", "cfg", "conf", "log",
}
IMG_EXT = ("png", "jpg", "jpeg", "webp")


def slug(text):
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "jogo"


def resolve_system(folder):
    key = re.sub(r"\s+", "_", folder.strip().lower())
    key = ALIASES.get(key, key)
    if key in SYSTEM_NAMES:
        return key
    norm = " " + re.sub(r"[^a-z0-9]+", " ", folder.lower()) + " "
    for k, v in ALIASES.items():
        if f" {k.replace('_', ' ')} " in norm:
            return v
    for k in SYSTEM_NAMES:
        if f" {k} " in norm:
            return k
    return None


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    games = []
    seen_ids = set()

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            continue
        segs = rel_dir.split("/")
        sys_id = None
        for seg in segs:
            sys_id = resolve_system(seg)
            if sys_id:
                break
        if not sys_id:
            continue

        file_map = {f.lower(): f for f in filenames}
        for fname in sorted(filenames):
            fl = fname.lower()
            if fl.startswith(".") or fl.startswith("readme") or fl.startswith("license"):
                continue
            ext = fl.rsplit(".", 1)[-1] if "." in fl else ""
            if ext in NON_GAME_EXT:
                continue

            full = os.path.join(dirpath, fname)
            rel_path = f"{rel_dir}/{fname}"
            clean = fname.rsplit(".", 1)[0] if "." in fname else fname
            base_id = f"{sys_id}_{slug(clean)}"
            gid = base_id
            k = 2
            while gid in seen_ids:
                gid = f"{base_id}_{k}"
                k += 1
            seen_ids.add(gid)

            # capa opcional com o mesmo nome do jogo na mesma pasta (.png/.jpg/.webp)
            cover_url = ""
            for iext in IMG_EXT:
                cand = f"{clean.lower()}.{iext}"
                if cand in file_map:
                    cover_url = RAW_BASE + quote(f"{rel_dir}/{file_map[cand]}", safe="/")
                    break

            item = {
                "id": gid,
                "name": clean,
                "system": sys_id,
                "section": "roms",
                "install_mode": "file",
                "filename": fname,
                "file_type": ext.upper(),
                "size": os.path.getsize(full),
                "download_url": RAW_BASE + quote(rel_path, safe="/"),
                "description": f"{SYSTEM_NAMES.get(sys_id, sys_id.upper())} • {fname}",
                "source": REPO,
            }
            if cover_url:
                item["cover"] = cover_url
            games.append(item)

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
