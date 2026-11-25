#!/usr/bin/env node
/**
 * Sobe jogos (e suas capas correspondentes) das pastas locais para GitHub Releases.
 *
 * Recursos:
 *  - Suporta arquivos até 2 GB cada (sem estourar os limites do Git!)
 *  - Divide automaticamente consoles com muitos arquivos em lotes (máx. 900 arquivos/release)
 *  - Retomável: pula arquivos que já existem na Release com o mesmo tamanho
 *  - Preserva o nome original do jogo no campo `label` da Release para o roms.json
 *  - Aciona automaticamente o GitHub Actions para regenerar o roms.json ao final
 *
 * Exemplos:
 *  node subir_releases.mjs --dry-run
 *  node subir_releases.mjs --dry-run gb nds dreamcast
 *  $env:GITHUB_TOKEN="ghp_..."; node subir_releases.mjs gb nds dreamcast n64 gba megadrive gbc
 *  $env:GITHUB_TOKEN="ghp_..."; node subir_releases.mjs --all
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const MAX_ASSETS_PER_RELEASE = 900; // margem segura abaixo do limite de 1000 do GitHub
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024 - 1024 * 1024; // ~2 GB

const SYSTEM_NAMES = {
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
};

const NON_GAME_EXT = new Set([
  "md", "txt", "nfo", "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico",
  "json", "xml", "yml", "yaml", "sh", "py", "lua", "js", "mjs", "css", "html", "htm",
  "pdf", "ini", "cfg", "conf", "log",
  "srm", "state", "rtc", "brm", "old", "sav", "nv", "eep", "fla", "mpk", "mcr", "vmu",
  "mp4", "avi", "mkv", "mov", "webm", "db", "ds_store",
]);

const IMG_EXT = new Set(["png", "jpg", "jpeg"]);

const IGNORED_SUBDIRS = new Set([
  "images", "downloaded_images", "downloaded_videos", "media", "default_images",
  "cheats", "savestates", "slot2", "backup", "logs_arrm", "gpsp", "genesis plus gx",
]);

function slug(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "jogo";
}

function sanitizeAssetName(filename) {
  const extIdx = filename.lastIndexOf(".");
  const stem = extIdx > 0 ? filename.slice(0, extIdx) : filename;
  const ext = extIdx > 0 ? filename.slice(extIdx).toLowerCase() : "";
  const cleanStem = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "") || "file";
  // Mantém abaixo de 180 caracteres para evitar limites de nome do GitHub
  const truncated = cleanStem.length > 170 ? cleanStem.slice(0, 170).replace(/[._-]+$/, "") : cleanStem;
  return `${truncated}${ext}`;
}

function isNonGameFile(fname) {
  const fl = fname.toLowerCase();
  if (fl.startsWith(".") || fl.startsWith("readme") || fl.startsWith("license") || fl.startsWith("gamelist")) {
    return true;
  }
  if (/\.a[12]\.bin$/i.test(fl)) return true; // saves VMU Dreamcast
  const idx = fl.lastIndexOf(".");
  if (idx <= 0) return true;
  const ext = fl.slice(idx + 1);
  return NON_GAME_EXT.has(ext);
}

function parseCoverKey(stem) {
  const low = stem.toLowerCase();
  if (low.endsWith("-marquee")) return null;
  const suffixes = [
    ["-boxfront", 1],
    ["-box2dfront", 1],
    ["-cover", 1],
    ["-image", 2],
    ["-thumb", 3],
  ];
  for (const [suf, prio] of suffixes) {
    if (low.endsWith(suf)) {
      return { key: slug(stem.slice(0, -suf.length)), prio };
    }
  }
  return { key: slug(stem), prio: 0 };
}

function walkFiles(dir, { skipIgnoredDirs = false } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipIgnoredDirs && IGNORED_SUBDIRS.has(entry.name.toLowerCase())) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function collectConsoleEntries(sysId, includeCovers) {
  const consoleDir = path.join(ROOT, sysId);
  if (!fs.existsSync(consoleDir)) return { pairs: [], skippedOversized: [] };

  // 1. Mapeia todas as capas disponíveis em todo o diretório do console (inclusive images/, downloaded_images/, media/)
  const coversBySlug = new Map();
  if (includeCovers) {
    for (const full of walkFiles(consoleDir, { skipIgnoredDirs: false })) {
      const fname = path.basename(full);
      const idx = fname.lastIndexOf(".");
      if (idx <= 0) continue;
      const ext = fname.slice(idx + 1).toLowerCase();
      if (!IMG_EXT.has(ext)) continue;
      const stem = fname.slice(0, idx);
      const parsed = parseCoverKey(stem);
      if (!parsed) continue;
      const prev = coversBySlug.get(parsed.key);
      if (!prev || parsed.prio < prev.prio) {
        coversBySlug.set(parsed.key, { prio: parsed.prio, full, ext });
      }
    }
  }

  // 2. Coleta todos os jogos válidos
  const gameFiles = walkFiles(consoleDir, { skipIgnoredDirs: true })
    .filter((f) => !isNonGameFile(path.basename(f)))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  const pairs = [];
  const skippedOversized = [];
  const seenNames = new Set();

  for (const full of gameFiles) {
    const fname = path.basename(full);
    const stat = fs.statSync(full);
    if (stat.size === 0) continue;
    if (stat.size > MAX_ASSET_BYTES) {
      skippedOversized.push({ full, size: stat.size });
      continue;
    }

    // Evita duplicar exatamente o mesmo nome de arquivo vindo de subpastas
    const lowerName = fname.toLowerCase();
    if (seenNames.has(lowerName)) continue;
    seenNames.add(lowerName);

    const stem = fname.slice(0, fname.lastIndexOf("."));
    const cover = includeCovers ? coversBySlug.get(slug(stem)) || null : null;
    pairs.push({
      game: { full, origName: fname, size: stat.size },
      cover: cover
        ? {
            full: cover.full,
            origName: `${stem}.${cover.ext}`,
            size: fs.statSync(cover.full).size,
          }
        : null,
    });
  }

  return { pairs, skippedOversized };
}

function buildReleaseChunks(sysId, pairs) {
  // Cada jogo + sua capa ficam na mesma Release; respeita MAX_ASSETS_PER_RELEASE
  const chunks = [];
  let current = [];
  let count = 0;

  for (const pair of pairs) {
    const needed = pair.cover ? 2 : 1;
    if (count + needed > MAX_ASSETS_PER_RELEASE && current.length > 0) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(pair);
    count += needed;
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunkPairs, idx) => {
    const tag = chunks.length === 1 ? sysId : `${sysId}-${idx + 1}`;
    const displayName = SYSTEM_NAMES[sysId] || sysId.toUpperCase();
    const title = chunks.length === 1 ? displayName : `${displayName} (Parte ${idx + 1}/${chunks.length})`;

    // Garante assetName único dentro desta Release
    const usedAssetNames = new Set();
    const assets = [];

    const allocName = (origName) => {
      let candidate = sanitizeAssetName(origName);
      if (!usedAssetNames.has(candidate.toLowerCase())) {
        usedAssetNames.add(candidate.toLowerCase());
        return candidate;
      }
      const dot = candidate.lastIndexOf(".");
      const base = dot > 0 ? candidate.slice(0, dot) : candidate;
      const ext = dot > 0 ? candidate.slice(dot) : "";
      let k = 2;
      while (usedAssetNames.has(`${base}.${k}${ext}`.toLowerCase())) k++;
      const unique = `${base}.${k}${ext}`;
      usedAssetNames.add(unique.toLowerCase());
      return unique;
    };

    for (const pair of chunkPairs) {
      const gameAssetName = allocName(pair.game.origName);
      assets.push({
        kind: "game",
        full: pair.game.full,
        origName: pair.game.origName,
        assetName: gameAssetName,
        size: pair.game.size,
      });
      if (pair.cover) {
        const gameStemSanitized = gameAssetName.slice(0, gameAssetName.lastIndexOf("."));
        const coverExt = pair.cover.origName.slice(pair.cover.origName.lastIndexOf(".")).toLowerCase();
        const coverAssetName = allocName(`${gameStemSanitized}${coverExt}`);
        assets.push({
          kind: "cover",
          full: pair.cover.full,
          origName: pair.cover.origName,
          assetName: coverAssetName,
          size: pair.cover.size,
        });
      }
    }

    const totalBytes = assets.reduce((acc, a) => acc + a.size, 0);
    return { sysId, tag, title, gamesCount: chunkPairs.length, assets, totalBytes };
  });
}

function detectRepo() {
  try {
    const url = execSync("git remote get-url origin", { cwd: ROOT, encoding: "utf8" }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
    if (match) return match[1];
  } catch {
    // fallback abaixo
  }
  return "AlexTayron/roms-games";
}

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  const ghCandidates = [
    "gh",
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
  ];
  for (const bin of ghCandidates) {
    try {
      const cmd = bin.includes(" ") ? `"${bin}" auth token` : `${bin} auth token`;
      const t = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (t) return t;
    } catch {
      // tenta próximo candidato
    }
  }
  return "";
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function apiRequest(url, token, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "HUB-STORE-release-uploader",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}

async function getOrCreateRelease(repo, tag, title, token) {
  const byTagUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  let resp = await apiRequest(byTagUrl, token);
  if (resp.status === 200) {
    const rel = await resp.json();
    // Lista todos os assets (paginação)
    const assets = [];
    let page = 1;
    while (true) {
      const aResp = await apiRequest(
        `https://api.github.com/repos/${repo}/releases/${rel.id}/assets?per_page=100&page=${page}`,
        token
      );
      if (!aResp.ok) throw new Error(`Erro listando assets de ${tag}: HTTP ${aResp.status}`);
      const batch = await aResp.json();
      assets.push(...batch);
      if (batch.length < 100) break;
      page++;
    }
    return { ...rel, assets };
  }
  if (resp.status !== 404) {
    const body = await resp.text();
    throw new Error(`Erro ao consultar release ${tag}: HTTP ${resp.status} — ${body}`);
  }

  const createResp = await apiRequest(`https://api.github.com/repos/${repo}/releases`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: "main",
      name: title,
      body: `Jogos de ${title} para a Loja de Jogos do HUB STORE.`,
      draft: false,
      prerelease: false,
    }),
  });
  if (!createResp.ok) {
    const body = await createResp.text();
    throw new Error(`Erro ao criar release ${tag}: HTTP ${createResp.status} — ${body}`);
  }
  const rel = await createResp.json();
  return { ...rel, assets: [] };
}

async function deleteAsset(repo, assetId, token) {
  const resp = await apiRequest(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, token, {
    method: "DELETE",
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Erro ao remover asset antigo ${assetId}: HTTP ${resp.status}`);
  }
}

async function uploadAssetWithRetry(repo, releaseId, item, token, maxRetries = 3) {
  const uploadUrl =
    `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets` +
    `?name=${encodeURIComponent(item.assetName)}&label=${encodeURIComponent(item.origName)}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const blob = await fs.openAsBlob(item.full);
      const ext = path.extname(item.assetName).toLowerCase();
      const contentType =
        ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        "application/octet-stream";
      const resp = await apiRequest(uploadUrl, token, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(item.size),
        },
        body: blob,
      });
      if (resp.ok) return await resp.json();

      const text = await resp.text();
      if ((resp.status >= 500 || resp.status === 429) && attempt < maxRetries) {
        const waitMs = 2000 * attempt;
        console.warn(`  [retry ${attempt}/${maxRetries}] HTTP ${resp.status} em ${item.origName}, aguardando ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`HTTP ${resp.status}: ${text}`);
    } catch (err) {
      if (attempt < maxRetries) {
        const waitMs = 2000 * attempt;
        console.warn(`  [retry ${attempt}/${maxRetries}] Falha em ${item.origName}: ${err.message}`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

async function triggerWorkflow(repo, token) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/gerar-roms-json.yml/dispatches`;
  const resp = await apiRequest(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  if (resp.status === 204) {
    console.log("\nWorkflow 'Atualizar roms.json automaticamente' acionado com sucesso!");
  } else {
    const text = await resp.text();
    console.warn(`\nAviso: não foi possível acionar o workflow automaticamente (HTTP ${resp.status}): ${text}`);
  }
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    all: false,
    includeCovers: true,
    concurrency: 2,
    repo: detectRepo(),
    consoles: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--no-covers") opts.includeCovers = false;
    else if (a === "--concurrency" && argv[i + 1]) opts.concurrency = Math.max(1, Math.min(5, Number(argv[++i]) || 2));
    else if (a === "--repo" && argv[i + 1]) opts.repo = argv[++i];
    else if (!a.startsWith("-")) opts.consoles.push(a.toLowerCase());
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let targetConsoles = opts.consoles;
  if (opts.all || targetConsoles.length === 0) {
    targetConsoles = fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && SYSTEM_NAMES[e.name.toLowerCase()] && e.name.toLowerCase() !== "easyrpg")
      .map((e) => e.name.toLowerCase())
      .sort();
  }

  const allChunks = [];
  let grandGames = 0;
  let grandAssets = 0;
  let grandBytes = 0;

  for (const sysId of targetConsoles) {
    if (!SYSTEM_NAMES[sysId]) {
      console.warn(`Aviso: pasta '${sysId}' não é um console reconhecido. Ignorando.`);
      continue;
    }
    const { pairs, skippedOversized } = collectConsoleEntries(sysId, opts.includeCovers);
    if (skippedOversized.length > 0) {
      console.warn(`Aviso (${sysId}): ${skippedOversized.length} arquivo(s) acima de 2 GB foram ignorados.`);
    }
    if (pairs.length === 0) continue;
    const chunks = buildReleaseChunks(sysId, pairs);
    for (const c of chunks) {
      allChunks.push(c);
      grandGames += c.gamesCount;
      grandAssets += c.assets.length;
      grandBytes += c.totalBytes;
    }
  }

  console.log(`\nRepositório: ${opts.repo}`);
  console.log(`Resumo do plano (${allChunks.length} release(s), ${grandGames} jogos, ${grandAssets} arquivos, ${formatMB(grandBytes)}):\n`);
  for (const c of allChunks) {
    console.log(
      `  • tag=${c.tag.padEnd(14)} | ${String(c.gamesCount).padStart(4)} jogos | ${String(c.assets.length).padStart(4)} arquivos (com capas) | ${formatMB(c.totalBytes).padStart(9)}`
    );
  }

  if (fs.existsSync(path.join(ROOT, "easyrpg")) && !opts.consoles.includes("easyrpg")) {
    console.log("\nNota: 'easyrpg/' foi ignorada por conter 26 mil arquivos soltos em subpastas (não compatível com arquivo único por jogo).");
  }

  if (opts.dryRun) {
    console.log("\nModo --dry-run ativo: nenhum arquivo foi enviado.");
    return;
  }

  const token = resolveToken();
  if (!token) {
    console.error("\nERRO: Token do GitHub não encontrado.");
    console.error("Defina a variável GITHUB_TOKEN antes de rodar (Personal Access Token com permissão 'repo'):");
    console.error('  $env:GITHUB_TOKEN = "ghp_SEU_TOKEN_AQUI"');
    console.error("  node subir_releases.mjs gb nds dreamcast");
    process.exit(1);
  }

  let uploadedTotal = 0;
  let skippedTotal = 0;
  let failedTotal = 0;

  for (const chunk of allChunks) {
    console.log(`\n=== Release '${chunk.tag}' (${chunk.title}) — ${chunk.assets.length} arquivos (${formatMB(chunk.totalBytes)}) ===`);
    const release = await getOrCreateRelease(opts.repo, chunk.tag, chunk.title, token);

    const existingByName = new Map();
    for (const a of release.assets) {
      existingByName.set(a.name.toLowerCase(), a);
    }

    const queue = [];
    for (const item of chunk.assets) {
      const existing = existingByName.get(item.assetName.toLowerCase());
      if (existing && existing.size === item.size) {
        skippedTotal++;
        continue;
      }
      queue.push({ item, existing });
    }

    if (queue.length === 0) {
      console.log(`  Todos os ${chunk.assets.length} arquivos já estão na release '${chunk.tag}'.`);
      continue;
    }

    console.log(`  Enviando ${queue.length} arquivo(s) (${chunk.assets.length - queue.length} já existentes)...`);

    let nextIdx = 0;
    const worker = async () => {
      while (nextIdx < queue.length) {
        const myIdx = nextIdx++;
        const { item, existing } = queue[myIdx];
        try {
          if (existing) {
            await deleteAsset(opts.repo, existing.id, token);
          }
          await uploadAssetWithRetry(opts.repo, release.id, item, token);
          uploadedTotal++;
          const pct = (((myIdx + 1) / queue.length) * 100).toFixed(0);
          console.log(`  [${myIdx + 1}/${queue.length} ${pct}%] OK: ${item.origName} (${formatMB(item.size)})`);
        } catch (err) {
          failedTotal++;
          console.error(`  [ERRO] ${item.origName}: ${err.message}`);
        }
      }
    };

    const workers = Array.from({ length: Math.min(opts.concurrency, queue.length) }, () => worker());
    await Promise.all(workers);
  }

  console.log(`\nConcluído! Enviados: ${uploadedTotal} | Já existentes (pulados): ${skippedTotal} | Erros: ${failedTotal}`);
  if (uploadedTotal > 0) {
    await triggerWorkflow(opts.repo, token);
  }
  if (failedTotal > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
