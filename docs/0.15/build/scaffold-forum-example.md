# Scaffold Forum Example

Now that you have Nix installed, let's use Holochain's scaffolding tool to scaffold a simple forum app.

### 1. Navigate to a folder where you want to set up the project

For example:

```bash
mkdir ~/Moss
```

```bash
cd ~/Moss
```

### 2. Scaffold app

Run the following command to scaffold a ready-to-use forum Holochain app.

```bash
nix run github:holochain/holochain#hc-scaffold -- example hello-world
```

::: tip ⚠️ package manager
The scaffolding tool will ask you to choose a package manager. This guide will assume that you choose `npm` as the package manager - if you choose a different package manager, replace the `npm` commands accordingly.
:::

::: tip ⚠️ UI Framework
The scaffolding tool will ask you to choose a UI framework (Lit/Svelte/React/Vue). This guide will assume that you choose **Lit** as UI framework. If you choose a different framework, you should still be able to follow along but may need to slightly adjust some of the steps.
:::

### 3. Build the app for use outside Moss

The app scaffolded in the previous step can be used in non-Moss contexts. Let's build it and test it out before we add the necessary sugar for it to run in Moss:

Navigate into the newly scaffolded folder:

```bash
cd forum
```

Enter nix shell to get the Holochain development tooling:

```bash
nix develop
```

Install dependencies

```bash
npm install
```

Run the app in non-Moss development mode to check whether it works:

```bash
npm run start
```

This should spawn 2 windows with the forum app running in them. If you create a post in one of the windows and reload the page in the other window (Right click > Reload) and the post should appear.
