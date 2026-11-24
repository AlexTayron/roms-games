# HUB STORE — Loja de Jogos (`roms-games`)

Repositório de jogos para a **Loja de Jogos** do **HUB STORE** (R36S), mantido por **Alex Tayron**.

## Como adicionar jogos (100% automático)

Crie pastas na raiz com o nome do console e envie os arquivos dos jogos dentro delas:

- `nes/` → instala em `/roms/nes`
- `snes/` → instala em `/roms/snes`
- `gba/`, `gbc/`, `gb/` → instala em `/roms/gba`, `/roms/gbc`, `/roms/gb`
- `megadrive/`, `mastersystem/`, `gamegear/` → instala em `/roms/megadrive`, `/roms/mastersystem`, `/roms/gamegear`
- `psx/`, `psp/`, `n64/`, `nds/`, `dreamcast/` → instala nas pastas correspondentes em `/roms/`
- `atari2600/`, `atari5200/`, `atari7800/`, `atarilynx/` → instala nas pastas correspondentes em `/roms/`
- `arcade/`, `mame/`, `mame2003/`, `neogeo/`, `cps1/`, `cps2/`, `cps3/` → instala nas pastas correspondentes em `/roms/`

> **Capa opcional:** se colocar um `.png` ou `.jpg` com o mesmo nome do arquivo do jogo na mesma pasta, ela aparece automaticamente como capa na Loja de Jogos!

Sempre que você enviar ou remover arquivos neste repositório, o GitHub Actions atualiza automaticamente o `roms.json`:

```
https://raw.githubusercontent.com/AlexTayron/roms-games/main/roms.json
```

Sem limite de API do GitHub e reconhecido automaticamente pelo HUB STORE!
