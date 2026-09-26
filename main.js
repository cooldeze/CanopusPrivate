const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let pipWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true, // hides menu bar, tap Alt to reveal (set to false if you want it gone entirely + comment out setMenu below)
    icon: path.join(__dirname, 'apple-touch-icon.png'), // swap with your own .ico for best Windows results
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Without this, Chromium throttles setInterval/setTimeout way down
      // once this window is occluded or minimized (i.e. exactly the state
      // it's in whenever someone actually uses the flight pop-out — the
      // whole point of the pop-out is to keep working in another app while
      // this window sits in the background). That throttling is what was
      // making tickFlight()'s countdown, and the tick data it feeds to the
      // pip window, stall until the person clicked back into Canopus.
      backgroundThrottling: false,
      // Bridges window.canopusFlightPip into index.html so it can open/close/
      // update the flight pop-out window — see preload.js and the flight
      // pop-out button/JS in index.html (toggleFlightPopout()).
      preload: path.join(__dirname, 'preload.js'),
      // Canopus uses localStorage/sessionStorage for the lock screen, theme,
      // ambient mixer, etc. — this works fine under Electron's default session.
    }
  });

  mainWindow.loadFile('index.html');

  // Uncomment to remove the menu bar completely (no File/Edit/View menu at all):
  // mainWindow.setMenu(null);

  // Keep internal navigation (your own pages) inside the app window,
  // but send any external links (http/https to other domains) to the
  // user's normal browser instead of hijacking the app window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalFile = url.startsWith('file://');
    if (!isLocalFile) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // No main window left to feed it data — close the pop-out along with it.
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
  });

  // Minimizing is the natural "I'm about to go do something else" signal —
  // auto-open the flight pop-out right then so the globe/timer are already
  // floating on top by the time the main window is out of the way. Handed
  // off to index.html rather than opened directly here, since only the
  // renderer knows whether there's actually an active session worth
  // showing (see the tracking-flight check around onAutoOpenRequest).
  mainWindow.on('minimize', () => {
    mainWindow.webContents.send('flight-pip:auto-open-request');
  });
}

/* ── Flight pop-out window ──
   A real native always-on-top BrowserWindow, not the web Document
   Picture-in-Picture API — Electron's Chromium build embeds the rendering
   engine only, not Chrome's browser-chrome window manager that API needs
   (still an open, unresolved request against Electron itself), so
   documentPictureInPicture is never available here. This gives the same
   "globe + timer stay on top while I use other apps" result, just via
   Electron's own APIs, and with a couple of niceties the web API can't
   offer — floats over fullscreen apps and follows you across virtual
   desktops/Spaces on macOS (see the setAlwaysOnTop/setVisibleOnAllWorkspaces
   calls below).

   index.html never touches BrowserWindow directly — it only talks to the
   small bridge preload.js exposes as window.canopusFlightPip (open/close/
   update), matching the flight-pip:* IPC channels here. */

/* ── Remember the pip window's size & position ──
   Written to a small JSON file in userData (not localStorage — this is
   main-process state about a native window, not app data belonging to
   either renderer) every time the window is moved/resized, debounced so
   dragging doesn't spam disk writes. Read back once at startup and used
   as the initial bounds for the next pip window, so it reopens exactly
   where/how big it was left. */
const PIP_STATE_FILE = path.join(app.getPath('userData'), 'pip-window-state.json');
let pipStateSaveTimer = null;

function loadPipState() {
  try {
    const raw = fs.readFileSync(PIP_STATE_FILE, 'utf8');
    const s = JSON.parse(raw);
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch (e) { /* no saved state yet, or it's corrupt — fall back to defaults */ }
  return null;
}

function savePipState(bounds) {
  clearTimeout(pipStateSaveTimer);
  pipStateSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(PIP_STATE_FILE, JSON.stringify(bounds)); } catch (e) { /* non-fatal */ }
  }, 400);
}

// Only trust a saved x/y if it still lands on a currently-connected
// display — otherwise (external monitor unplugged, resolution changed,
// etc.) the pop-out would reopen off-screen and be unreachable. Size is
// always trusted; only position gets this check.
function isPointOnAnyDisplay(x, y) {
  return screen.getAllDisplays().some(d => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  });
}

// A saved size from before a minWidth/minHeight change (e.g. testing a
// smaller floor, or an older version of the app) could be below today's
// minimum — Electron's own minWidth/minHeight only stops the person from
// resizing below it by hand, it doesn't retroactively fix a bounds object
// loaded from disk. Clamp on read so the pop-out never reopens smaller than
// the current floor.
const PIP_MIN_WIDTH = 150;
const PIP_MIN_HEIGHT = 170;

function createPipWindow() {
  const saved = loadPipState();
  if (saved) {
    saved.width = Math.max(PIP_MIN_WIDTH, saved.width);
    saved.height = Math.max(PIP_MIN_HEIGHT, saved.height);
  }
  const hasValidPosition = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
    && isPointOnAnyDisplay(saved.x, saved.y);

  const opts = {
    width: saved ? saved.width : 300,
    height: saved ? saved.height : 340,
    // A real floor rather than the near-zero one used previously — small
    // enough to shrink meaningfully, large enough that the timer, status
    // text, and top-corner buttons stay usable.
    minWidth: PIP_MIN_WIDTH,
    minHeight: PIP_MIN_HEIGHT,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    // transparent:true is required for the window's background to ever be
    // able to go see-through — backgroundColor below still defaults to
    // opaque black so the pop-out looks exactly like before until the
    // person turns on "Transparent background" in pip.html's settings
    // panel, which calls setBackgroundColor('#00000000') on this window
    // at runtime (see the flight-pip:set-transparent handler below).
    transparent: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'pip-preload.js')
    }
  };
  if (hasValidPosition) { opts.x = saved.x; opts.y = saved.y; }

  pipWindow = new BrowserWindow(opts);

  const persistBounds = () => {
    if (!pipWindow || pipWindow.isDestroyed()) return;
    savePipState(pipWindow.getBounds());
  };
  pipWindow.on('resize', persistBounds);
  pipWindow.on('move', persistBounds);

  // 'screen-saver' level floats above fullscreen apps too (macOS-specific,
  // harmless no-op elsewhere).
  pipWindow.setAlwaysOnTop(true, 'screen-saver');
  // Keep it visible when the user switches virtual desktops/Spaces
  // (macOS/Linux — no-op on Windows, which doesn't have this concept).
  if (typeof pipWindow.setVisibleOnAllWorkspaces === 'function') {
    pipWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  pipWindow.loadFile('pip.html');

  pipWindow.on('closed', () => {
    pipWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('flight-pip:closed');
    }
  });
}

ipcMain.handle('flight-pip:open', () => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.focus();
    return Promise.resolve(true);
  }
  // Wait for pip.html to actually finish loading (and therefore have its
  // canopusPipBridge.onData listener attached) before resolving. Without
  // this, index.html's startFlightPipElectronLoop() fires its first
  // flight-pip:update (the one-time init payload with geoData/theme/route)
  // the instant this promise resolves — if that lands before pip.html has
  // registered its listener, the init payload is silently dropped and the
  // pop-out globe never gets its country borders or theme color, staying
  // on whatever pip.html's hardcoded pre-init default is.
  createPipWindow();
  return new Promise((resolve) => {
    pipWindow.webContents.once('did-finish-load', () => resolve(true));
  });
});

ipcMain.on('flight-pip:close', () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});

ipcMain.on('flight-pip:update', (_event, data) => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.webContents.send('flight-pip:data', data);
  }
});

// Pop-out asked to toggle real window-level transparency (the "Transparent
// background" checkbox in pip.html's settings panel). Only works because
// createPipWindow() above sets transparent:true at construction — Electron
// can change the alpha of a window's backgroundColor at runtime, but can't
// turn transparency on/off for a window that wasn't created with it.
ipcMain.on('flight-pip:set-transparent', (_event, on) => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.setBackgroundColor(on ? '#00000000' : '#000000');
  }
});

// Pop-out asked to resize itself (the "Size" slider). This is a convenience
// alongside native edge-dragging, not a replacement for it — clamped to the
// window's own minWidth/minHeight automatically by setSize.
ipcMain.on('flight-pip:resize', (_event, { width, height }) => {
  if (pipWindow && !pipWindow.isDestroyed() && Number.isFinite(width) && Number.isFinite(height)) {
    pipWindow.setSize(Math.round(width), Math.round(height));
  }
});

// Pop-out → main window: spacebar was pressed in the pip window. Relayed
// through here (rather than the pip having any direct handle on the main
// window) because contextIsolation + separate BrowserWindows means the two
// renderers can't reach each other except via the main process.
ipcMain.on('flight-pip:pause-toggle', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('flight-pip:pause-toggle-request');
  }
});

function setAutoLaunch() {
  // Built-in Electron API for launching at login. Works well for packaged
  // apps (electron-builder/electron-forge) on Windows and macOS.
  // NOTE: On Linux this API is unreliable across distros — if you're
  // targeting Linux, use the `auto-launch` npm package instead, or ship a
  // .desktop file to ~/.config/autostart/ during install.
  // NOTE: This only has effect in a packaged app — running via `electron .`
  // in dev mode will not actually register anything useful.
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false // macOS only — set true to start in the background
    });
  }
}

app.whenReady().then(() => {
  setAutoLaunch();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});