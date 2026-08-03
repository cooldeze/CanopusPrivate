# Canopus — Desktop App Setup

This folder is a ready-to-go Electron project. It already contains `main.js`
and `package.json` — you just need to (1) drop in the rest of your files and
(2) run a couple of commands.

## 1. Add your missing files

Only the HTML pages you uploaded are in here so far:
`index.html, conflicts.html, empires.html, interests.html, jeejournal.html,
library.html, neonborderfullscreen.html, sirius.html, vault.html,
videoclock.html`

Copy the rest of your real Canopus folder contents in here too, especially:
- `retro-theme.css`, `vhs-theme.css`, `harsh-mode.css`
- `manifest.json`
- `favicon.ico`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`
- any other pages (Focus, Schedule, Sky, Capsule, Literature, Passport,
  Flight Tracker, Terminal, etc.) and any images/data files they use

Everything needs to sit **flat in this same folder** (or in the same
relative subfolders your `<link>`/`<script>`/`<img>` paths already expect),
exactly like it does in your GitHub repo.

## 2. Install Node.js (if you haven't already)

Download the LTS installer from https://nodejs.org, run it, then confirm:
```
node -v
npm -v
```

## 3. Install dependencies

Open PowerShell in this folder and run:
```
npm install
```
This pulls in Electron and electron-builder (only needs internet once).

## 4. Test it

```
npm start
```
Canopus should open in its own window. Click around your pages
(conflicts, empires, vault, etc.) to make sure navigation and all the
CSS/fonts/icons are loading correctly.

## 5. Package it into a Windows installer

```
npm run dist
```
This produces `dist/Canopus Setup <version>.exe` — a normal Windows
installer. Running it installs Canopus with a Start Menu entry and
desktop shortcut, fully self-contained.

## Notes

- `main.js` currently points the window icon at `apple-touch-icon.png`.
  For a proper Windows taskbar icon, generate an `icon.ico` (256x256,
  multi-size) from your logo — https://icoconvert.com works well — and
  place it in this folder. The `package.json` build config already
  references `icon.ico` for the installer/exe icon.
- External links (anything not `file://`) automatically open in your
  default browser instead of inside the app window — this keeps the
  app window dedicated to Canopus itself.
- Your `index.html` still pulls Google Fonts and Tabler Icons from a
  CDN. That will need internet the first time (and any time after, since
  browsers don't cache those forever in an Electron profile in a way you
  can rely on). Say the word if you want these self-hosted for a fully
  offline app — I can pull them down and rewire the `<link>` tags.
- To hide the menu bar entirely instead of just auto-hiding it, uncomment
  the `mainWindow.setMenu(null);` line in `main.js`.
