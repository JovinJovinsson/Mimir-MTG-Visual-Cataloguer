# Mimir

<p align="center">
  <img src="Mimir.png" alt="Mimir icon" width="128" />
</p>

A local-first desktop app for scanning and cataloguing Magic: The Gathering cards. Point your webcam at a card, Mimir identifies it via perceptual hash matching against the full Scryfall catalogue, and adds it to your collection — no internet required after the initial data download.

## Features

- **Camera scanner** — real-time card detection and identification; no barcode or QR code needed
- **Perceptual hash matching** — works on foils, etched foils, and cards with glare
- **Review queue** — low-confidence scans are held for human confirmation before entering the catalogue
- **Collections** — organise cards into named collections; move cards between them
- **CSV export** — Moxfield, Deckbox, Manabox, or native Mimir format
- **Auto-backup** — scheduled ZIP backups of your catalogue to a folder of your choosing
- **Offline-first** — all data lives in a local SQLite database; Scryfall is only contacted to refresh card data

## Usage

1. **First start:** Mimir downloads the Scryfall card data once (a few hundred MB). Wait for it to finish.
2. **Scan page:** pick your camera. Optionally set the preset bar (Foil, Condition, Language, Destination collection) — it applies to every card scanned until you change it.
3. **Scan cards hands-free:** hold a card in front of the camera. There is no scan button. An outline shows what is happening:
   - **yellow** — card detected, waiting for it to hold still (~0.2 s)
   - **green** — captured; the card is queued for recognition
4. **Next card:** take the card away and show the next one. A card is only captured again after it has left the view, so keep each card still, on a dark plain background with even light (avoid glare).
5. **Results:** confident matches go straight into the selected collection (default: *Inbox*). Uncertain ones go to the **Review** queue (press `R` on the Scan page). There: `1`–`9` pick a candidate, `Space` confirms, `S` skips, `D` dismisses.
6. **Export:** use the catalogue/collection export for a CSV (Moxfield, Deckbox, Manabox or Mimir format).

Capture sound and green flash can be toggled in Settings.

## Download

Grab the latest release for your platform from the [Releases](../../releases) page:

| Platform | File |
|----------|------|
| macOS | `Mimir-x.y.z.dmg` (universal — Intel + Apple Silicon) |
| Windows | `Mimir-Setup-x.y.z.exe` |
| Linux | `Mimir-x.y.z.AppImage` or `mimir_x.y.z_amd64.deb` |

### macOS note

The app is not notarised yet. On first launch, right-click the app → **Open** → **Open** to bypass Gatekeeper.

### Windows note

Windows SmartScreen may warn on first run. Click **More info → Run anyway** to proceed.

## Development

### Prerequisites

- Node.js 20+
- Python 3 and build tools (for `better-sqlite3` native compilation)
  - macOS: `xcode-select --install`
  - Windows: `npm install --global windows-build-tools`
  - Linux: `sudo apt-get install python3 make g++`

### Setup

```bash
git clone https://github.com/JovinJovinsson/mimir.git
cd mimir
npm install
npm run dev
```

`npm run dev` builds everything, rebuilds native modules for Electron, and launches the app.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Build and launch in development mode |
| `npm run build` | Compile TypeScript + copy assets to `dist/` |
| `npm run package` | Build a distributable for the current platform (unsigned) |
| `npm run typecheck` | TypeScript type check without emitting |
| `npm test` | Run the test suite |

### Project layout

```
src/
  main/       Electron main process (Node.js)
  renderer/   Renderer process (browser)
  shared/     IPC channel types shared between both
tests/        Vitest unit tests
build/        electron-builder resources (entitlements, afterSign hook)
```

## Data

Mimir stores everything in your OS user-data directory:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Mimir/` |
| Windows | `%APPDATA%\Mimir\` |
| Linux | `~/.config/Mimir/` |

The `catalogue.db` SQLite file is the source of truth. Back it up (or use the built-in auto-backup) before uninstalling.

## Releasing

Push a version tag to trigger the CI build:

```bash
npm version patch   # bumps package.json version
git push --follow-tags
```

The GitHub Actions workflow builds, signs (when credentials are present), and publishes a draft release for each platform. See [`SIGNING.md`](SIGNING.md) for signing setup.

## License

MIT
