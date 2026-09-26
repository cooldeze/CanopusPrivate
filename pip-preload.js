const { contextBridge, ipcRenderer } = require('electron');

/* Exposed to pip.html as window.canopusPipBridge. contextIsolation is on
   (see main.js), so this is the only way pip.html can reach the main
   process. Mirrors the shape of preload.js (window.canopusFlightPip) but
   scoped to what the pop-out itself needs: receiving data pushed from the
   main window, and sending its own small set of requests back up. */
contextBridge.exposeInMainWorld('canopusPipBridge', {
  // One-time init payload (geoData/theme/route) on open, then a small
  // text/number 'tick' payload roughly once a second after that — see the
  // flight-pip:update handler in main.js and the onData handler in pip.html.
  onData: (cb) => ipcRenderer.on('flight-pip:data', (_event, data) => cb(data)),

  // Close button in pip.html.
  requestClose: () => ipcRenderer.send('flight-pip:close'),

  // Spacebar / timer click in pip.html — relayed via main.js to the main
  // window's toggleActivePause(), since the two renderers can't reach each
  // other directly under contextIsolation.
  requestPauseToggle: () => ipcRenderer.send('flight-pip:pause-toggle'),

  // "Transparent background" checkbox in the settings panel — toggles real
  // OS-level window transparency (see the flight-pip:set-transparent
  // handler in main.js).
  setTransparent: (on) => ipcRenderer.send('flight-pip:set-transparent', on),

  // "Size" slider in the settings panel — a convenience alongside native
  // edge-dragging (see the flight-pip:resize handler in main.js).
  requestResize: (width, height) => ipcRenderer.send('flight-pip:resize', { width, height })
});