# Install Moss Dependencies

Now that the holochain app works outside Moss, let's add some Weave/Moss specific dependencies.

### Weave Dev CLI

<!-- VERSION_REPLACE -->

The Weave dev CLI will allow you to run yor Tool in a sandboxed instance of Moss with hot-reloading. Install it as a dev dependency:

```bash
npm install -d @theweave/cli@0.13.0-beta.5
```

### Weave Client

<!-- VERSION_REPLACE -->

The Weave API npm package will allow your Tool's frontend to interact with Moss using the `WeaveClient` class. Install it into the workspace of your frontend code:

```bash
npm install -w ui @theweave/api@0.1.0
```
