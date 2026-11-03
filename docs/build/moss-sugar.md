# Install Moss Dependencies

Now that the Holochain app works outside Moss, let's add some Weave/Moss specific dependencies.

Moss 0.16 needs `@theweave/cli` 0.16.x and `@theweave/api` 0.7.x. To see the published versions, run `npm view @theweave/cli versions` and `npm view @theweave/api versions`, then install the newest ones from those lines.

### Weave Dev CLI

The Weave dev CLI will allow you to run your Tool in a sandboxed instance of Moss with hot-reloading. Install it as a dev dependency:

```bash
npm install -D @theweave/cli@<0.16 version>
```

### Weave Client

The Weave API npm package will allow your Tool's frontend to interact with Moss using the `WeaveClient` class. Install it into the workspace of your frontend code:

```bash
npm install -w ui @theweave/api@<0.7 version>
```
