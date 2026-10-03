/**
 * Builds a `beforeunload` listener that holds a window while its applets save.
 *
 * The browser honors a cancelled unload only if the listener cancels before it
 * returns, so the listener cancels at once and then finishes the reload or
 * close itself through `finish`. In Electron, opening an external location
 * also fires `beforeunload`; for that one the window stays as it is. Repeated
 * unloads while a save runs are cancelled and do not start a second save.
 */
export function holdUnloadWhileSaving(options: {
  isExternalNavigation: () => Promise<boolean>;
  save: () => Promise<void>;
  finish: () => void;
}): (e: BeforeUnloadEvent) => void {
  let saving = false;
  return (e) => {
    e.preventDefault();
    e.returnValue = false;
    if (saving) return;
    saving = true;
    void (async () => {
      if (await options.isExternalNavigation()) {
        saving = false;
        return;
      }
      try {
        await options.save();
      } catch (err) {
        console.error('Saving before unload failed:', err);
      }
      options.finish();
    })();
  };
}

/**
 * Resolves true if the main process reports, within a short window, that the
 * unload came from opening an external location, and false otherwise.
 */
export function externalNavigationReported(
  onWillNavigateExternal: (callback: () => void) => void,
  removeWillNavigateListeners: () => void,
  windowMs = 500,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeWillNavigateListeners();
      resolve(false);
    }, windowMs);
    onWillNavigateExternal(() => {
      clearTimeout(timer);
      removeWillNavigateListeners();
      resolve(true);
    });
  });
}
