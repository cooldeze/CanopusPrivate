const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow = null;

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
}

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