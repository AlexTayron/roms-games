# HUB STORE — Loja de Jogos (`roms-games`)

Repositório de jogos para a **Loja de Jogos** do **HUB STORE** (R36S), mantido por **Alex Tayron**.

## Como adicionar jogos (100% automático)

### Opção 1 — GitHub Releases (recomendado para pacotes grandes e arquivos > 100 MB)

GitHub Releases aceita arquivos de até **2 GB cada** e não conta no limite de tamanho do repositório Git.

1. Crie um Personal Access Token no GitHub com permissão `repo` (ou faça login no `gh` CLI).
2. Simule o envio para conferir o resumo:
   ```powershell
   node subir_releases.mjs --dry-run
   ```
3. Envie os consoles desejados (o script é retomável e pula arquivos já enviados):
   ```powershell
   $env:GITHUB_TOKEN = "ghp_SEU_TOKEN_AQUI"
   node subir_releases.mjs gb nds dreamcast n64 gba megadrive gbc
   ```
   Ou envie todos de uma vez:
   ```powershell
   node subir_releases.mjs --all
   ```

O script cria automaticamente uma Release por console (ex.: `dreamcast`, `n64`, `nds`, `gba`, `megadrive-1`, `megadrive-2`, `gbc-1`...), envia os jogos com suas capas e aciona o GitHub Actions para atualizar o `roms.json`.

### Opção 2 — Pastas na raiz (para poucos arquivos menores que 100 MB)

Também continua funcionando colocar pastas de console direto no repositório (ex.: `nes/`, `snes/`, `gba/`).

> **Capa opcional:** um `.png` ou `.jpg` com o mesmo nome do arquivo do jogo (ou `-image.png` / `-thumb.png`) aparece automaticamente como capa na Loja de Jogos!

Sempre que uma Release for publicada/editada ou houver push no repositório, o GitHub Actions atualiza automaticamente o `roms.json`:

```
https://raw.githubusercontent.com/AlexTayron/roms-games/main/roms.json
```

Sem limite de API do GitHub e reconhecido automaticamente pelo HUB STORE!
