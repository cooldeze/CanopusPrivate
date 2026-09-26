const { contextBridge, ipcRenderer } = require('electron');

/* Exposed to index.html as window.canopusFlightPip. contextIsolation is on
   (see main.js), so this is the only way the renderer can reach the main
   process — everything here is deliberately narrow: open/close a window
   and push a lightweight data snapshot, nothing that touches the filesystem
   or lets the page control Electron itself. */
contextBridge.exposeInMainWorld('canopusFlightPip', {
  open: () => ipcRenderer.invoke('flight-pip:open'),
  close: () => ipcRenderer.send('flight-pip:close'),
  update: (data) => ipcRenderer.send('flight-pip:update', data),
  onClosed: (cb) => ipcRenderer.on('flight-pip:closed', () => cb()),
  // Fired when the person presses spacebar inside the pip window — index.html
  // wires this to the same toggleActivePause() the in-app spacebar shortcut
  // and timer click use, so pausing from the pop-out is a real pause, not
  // just a cosmetic change in the small window.
  onPauseToggleRequest: (cb) => ipcRenderer.on('flight-pip:pause-toggle-request', () => cb()),
  // Fired when the main window is minimized — index.html decides whether
  // there's actually an active session worth popping out for.
  onAutoOpenRequest: (cb) => ipcRenderer.on('flight-pip:auto-open-request', () => cb())
});