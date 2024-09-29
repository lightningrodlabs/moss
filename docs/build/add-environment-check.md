# Add Environment Check

::: tip ⚠️ UI Framework
This code will need to be adapted if you did not choose Lit as the UI framework earlier. The logic will remain the same but the code will need to be placed in different files/places.
:::

### 1. Add Imports

At the top of `ui/src/holochain-app.ts`, add the following imports:

<!-- DOCS_TODO Rename -->

```typescript
import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api'; // [!code ++]
```

### 2. Add Hot-Reloading

Add code to allow hot-reloading when later running your app in a sandboxed version of Moss.

For this, modify the code in `ui/src/holochain-app.ts` to insert the following code in the `firstUpdated()` method:

```typescript
  async firstUpdated() {
    this.loading = true;

    // This line is assuming that you are using Vite as your dev server. If  // [!code ++]
    // you are using a different bundler, you may need to adjust the logic // [!code ++]
    // to determine whether your Tool is running in dev mode or not.  // [!code ++]
    const isRunningInDevMode = (import.meta as any).env.DEV;  // [!code ++]
      // [!code ++]
    if (isRunningInDevMode) { // [!code ++]
      try { // [!code ++]
        await initializeHotReload(); // [!code ++]
      } catch (e) { // [!code ++]
        console.warn( // [!code ++]
          'Could not initialize applet hot-reloading. This is only expected to work in a Weave context in dev mode.' // [!code ++]
        ); // [!code ++]
      } // [!code ++]
    } // [!code ++]

    try {
      this.client = await AppWebsocket.connect();
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
```

### 3. Connect `WeaveClient` in Weave context

Add a check to determine wheter your app is running in a Weave context and if yes, connect the `WeaveClient` and use the app websocket connection that it contains instead of connecting with the `AppWebsocket` class.

```typescript
  async firstUpdated() {
    this.loading = true;

    // insert hot-reloading logic here
    if ((import.meta as any).env.DEV) {
      try {
        await initializeHotReload();
      } catch (e) {
        console.warn(
          'Could not initialize applet hot-reloading. This is only expected to work in a Weave context in dev mode.'
        );
      }
    }

    try {
      this.client = await AppWebsocket.connect(); // [!code --]
      if (isWeaveContext()) { // [!code ++]
        const weaveClient = await WeaveClient.connect(); // [!code ++]
        if (weaveClient.renderInfo.type !== "applet-view") throw new Error("This Tool does not implement cross-group views yet"); // [!code ++]
        this.client = weaveClient.renderInfo.appletClient; // [!code ++]
      } else { // [!code ++]
        this.client = await AppWebsocket.connect(); // [!code ++]
      } // [!code ++]
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
```
