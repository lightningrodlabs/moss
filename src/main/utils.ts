import { BrowserWindow, shell } from 'electron';

export function setLinkOpenHandlers(browserWindow: BrowserWindow): void {
  // links in happ windows should open in the system default application
  browserWindow.webContents.on('will-frame-navigate', (e) => {
    console.log('GOT WILL-NAVIGATE EVENT: ', e);
    if (e.url.startsWith('http://localhost:')) {
      // ignore vite routing in dev mode
      return;
    }
    if (e.url.startsWith('we://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto://')
    ) {
      e.preventDefault();
      shell.openExternal(e.url);
    }
  });
  // instead of the webview
  browserWindow.webContents.on('will-navigate', (e) => {
    console.log('GOT WILL-NAVIGATE EVENT: ', e);
    if (e.url.startsWith('http://localhost:')) {
      // ignore vite routing in dev mode
      return;
    }
    if (e.url.startsWith('we://')) {
      emitToWindow(browserWindow, 'deep-link-received', e.url);
    }
    if (
      e.url.startsWith('http://') ||
      e.url.startsWith('https://') ||
      e.url.startsWith('mailto://')
    ) {
      e.preventDefault();
      shell.openExternal(e.url);
    }
  });

  // Links with target=_blank should open in the system default browser and
  // happ windows are not allowed to spawn new electron windows
  browserWindow.webContents.setWindowOpenHandler((details) => {
    console.log('GOT NEW WINDOW EVENT: ', details);
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      shell.openExternal(details.url);
    }
    return { action: 'deny' };
  });
}

export function emitToWindow<T>(targetWindow: BrowserWindow, channel: string, payload: T): void {
  targetWindow.webContents.send(channel, payload);
}
