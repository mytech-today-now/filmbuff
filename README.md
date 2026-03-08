# FilmBuff

**AI-powered writing and screenplay tools — Creative Writing Edition**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/mytech-today-now/filmbuff)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40mytechtoday%2Ffilmbuff-red.svg)](https://www.npmjs.com/package/@mytechtoday/filmbuff)

FilmBuff provides comprehensive writing standards, screenplay tools, and AI-powered shot list generation for screenwriters and creative professionals.

## 🎯 Purpose

FilmBuff extends Augment Code AI with **1M+ characters** of writing guidelines, 60+ cinematic style guides, 18+ genre modules, and AI-powered production tools.

## 📦 Modules

### writing-standards/screenplay/

- **Core** — Universal formatting, narrative structures, character development, dialogue, continuity
- **13 Narrative Styles** — Linear, non-linear, ensemble, minimalist, epic, satirical, poetic, realistic, surreal, experimental, voice-over, flashback, dialogue-centric
- **60+ Cinematic Styles** — Director guides, franchise guides, comedy formats, narrative theory
- **18+ Genres** — Action, comedy, drama, fantasy, horror, mystery, romance, sci-fi, thriller, and more
- **Commercials** — Commercial writing rules with FTC compliance validation
- **Schemas** — Character profiles, beat sheets, plot outlines, trope inventories
- **Templates** — Genre, style, and theme templates

### writing-standards/literature/

- **Shakespeare** — Literary analysis module

### workflows/

- **Beads** — Task tracking workflow
- **Beads Integration** — Beads configuration and rules

## 🚀 Quick Start

```bash
npm install -g @mytechtoday/filmbuff
filmbuff --version
filmbuff init
filmbuff link writing-standards/screenplay
filmbuff generate-shot-list script.fountain
```

## 📥 Installation

Install FilmBuff globally with npm so the `filmbuff` command is added to your shell path:

```bash
npm install -g @mytechtoday/filmbuff
filmbuff --help
```

If your shell still does not recognize `filmbuff` immediately after install, open a new terminal so it reloads the global npm bin path.

## 🔧 CLI Commands

| Command | Description |
|---------|-------------|
| `filmbuff init` | Initialize in a project |
| `filmbuff link <module>` | Link writing modules |
| `filmbuff list` | List available modules |
| `filmbuff show <module>` | Display module content |
| `filmbuff search <term>` | Search for modules |
| `filmbuff generate-shot-list` | AI-powered shot list generation |
| `filmbuff generate-treatment` | AI-powered treatment generation |
| `filmbuff validate` | Validate module structure |
| `filmbuff upgrade` | Upgrade to latest version |

## 📄 License

MIT — see [LICENSE](./LICENSE)
