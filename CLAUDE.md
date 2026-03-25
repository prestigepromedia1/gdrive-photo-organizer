# image-asset-pipeline — CLAUDE.md

## Project
AI-powered image categorization, metadata renaming, and indexing. Turns folders of `IMG_4530.jpg` into organized, searchable asset libraries.

**Stack:** Python · Anthropic Claude Vision · Google Cloud Vision OCR · Google Drive API

## Commands
```bash
# Organize images into category folders
python image_asset_pipeline.py organize ./photos --local --catalog categories.json

# Rename with metadata-rich names
python image_asset_pipeline.py rename ./photos/Organized --local

# Export asset index
python image_asset_pipeline.py index ./photos/Organized --local --format csv

# Find duplicates
python image_asset_pipeline.py dedup ./photos --local

# Organize with style sub-folders (Product Shot, Lifestyle, etc.)
python image_asset_pipeline.py organize ./photos --local --catalog categories.json --with-styles
```

All commands work with Google Drive too — drop `--local` and use a Drive folder ID.

## Pipeline
```
organize → rename → index
```
1. **Organize** — AI sorts images into category folders via three-tier identification: filename keywords → OCR label text → Claude Vision fallback
2. **Rename** — Bulk rename with template: `{category}_{style}_{seq}` (customizable)
3. **Index** — Export CSV/JSON asset manifest
4. **Dedup** — Find duplicates by checksum

## Key Files
- `image_asset_pipeline.py` — Main CLI (all 4 commands)
- `categories.json` — Category catalog with keywords + OCR label text map
- `categories_example.json` — Example catalog format

## Architecture
- Three-tier identification: filename match (free) → Cloud Vision OCR (~$1.50/1K images) → Claude Vision fallback (~$0.01-0.03/image)
- Low-confidence matches (< 0.60) go to `_Review/` for manual sorting
- Google Drive mode uses OAuth 2.0 credentials (`credentials.json`)

## Gotchas
- `ANTHROPIC_API_KEY` required for Claude Vision fallback
- Google Cloud Vision API must be enabled separately for OCR
- `--dry-run` available on organize and rename — use it first
- `credentials.json` for Drive mode is never committed

## Ecosystem Context
<!-- last_ecosystem_sync: 2026-03-23 -->
This tool is part of the PPM Compounding Delivery System (10 tools across 2 orgs).

- **Role in ecosystem:** Client onboarding tool for image assets. When a new client arrives with thousands of unorganized images, this tool visually identifies each image based on product context, organizes into folders, renames with meaningful names, and indexes everything into a searchable library. Pre-ingestion step that feeds Creative Pipeline.
- **Reads from:**
  - Raw client image folders (unorganized, e.g. `IMG_4530.jpg`)
- **Writes to:**
  - Organized asset library → Google Drive photo library consumed by Creative Pipeline
- **Current gaps:**
  - No automated trigger — runs manually per client onboarding
  - No connection to CreativeHQ asset management
  - Taxonomy/naming output not yet aligned with ecosystem-wide asset_id convention (Phase 1d)
- **Ecosystem map:** See `prestigepromedia1/beirut` repo for full architecture
- **Key constraint:** image-asset-pipeline's north star comes first. Ecosystem connections are additive.
- **Boundary rule:** North star wins inside this tool. Holistic design wins at interfaces between tools.
