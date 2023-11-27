# We Applet

A *we* applet is a Holochain application and associated UI that's only intended to be used inside the `We` environment. This means that the UI, instead of rendering a full blown web application, only renders the appropriate elements that the `We` framework requests.

At the technical level, a we applet is just a normal `.webhapp`, with 2 main differences from any other web happ:

- UI code:
  - Your UI code may offer different rendering modes or UI widgets as well as offer AppletServices like search, attachments and more that We or other Applets can make use of

- hApp code:
  - You don't need the profiles zome or any other zome that deals with profiles, as they will be managed by the we group DNA.

##  How to create a we applet

Check out the [README](../ui/libs/we-applet/README.md) of the @lightningrodlabs/we-applet package to see how to modify your hApp UI in order to become We compatible.

### [⚠️ Currently Outdated ⚠️] Scaffolding

This guide assumes you have the [holochain nix environment](https://developer.holochain.org/quick-start/) set up.

1. Run this command:

```bash
nix run github:holochain/holochain#hc-scaffold -- web-app --templates-url https://github.com/lightningrodlabs/we
```

And run through the instructions for that command.

From this point on, you can continue scaffolding your we applet like any normal holochain app, with commands like `hc scaffold dna` or `hc scaffold zome`. For an introduction on how to scaffold a hApp using the scaffolding tool, go [here](https://developer.holochain.org/get-building/).

### Testing

The easiest way to test your applets is to use the [main we desktop executable](https://github.com/lightningrodlabs/we/releases) in testing mode, and setting the `test-applets` and `network-seed` CLI arguments.

- `test-applets` is a list of paths to .webhapp applets that you want to test.
- `network-seed` is the network-seed that will be used to create the group and install the applets in the group, and also the default apps (DevHub and AppStore).

If you set these CLI arguments, `we` will start in a completely separate profile in a temporary directory, it will create a new empty group, and install the given applets to that group, without uploading them to the appstore.

It is also important to set the `BOOTSTRAP_PORT` and `SIGNAL_PORT` environment variables if you don't want to use the production services. If those variables are set, `we` will try to connect to `ws://127.0.0.1:$BOOTSTRAP_PORT` and `ws://127.0.0.1:SIGNAL_PORT`. You can run these services using `hc run-local-services`.

On Linux, this would be:

```bash
./we-alpha_[latest_version]_amd64.AppImage --test-applets applet1.webhapp applet2.webhapp --network-seed test
```

Run this command in a separate terminal for each agent that you want to test your applet with.

#### Other CLI arguments

- `profile` is the name of the internal folder that we will use to store all its data. Changing the profile allows for setting up test networks without losing the data for your default installation of we.
  - Using `test-applets` will ignore this argument and just use a temporary directory.

### Publishing applets to the DevHub

This guide assumes you have [we installed in your computer](https://github.com/lightningrodlabs/we/releases).

1. Package your `.webhapp` by running `npm run package:applet` from the root folder of the scaffolded project.
2. Open we, go into the app library of any of your groups, and click the `Publish an applet` button on the top-right corner.
3. This will prompt you to enable the developer mode. Do so and open the DevHub.
4. Follow [this guide to publish your app](https://github.com/holochain/launcher#publishing-and-updating-an-app-in-the-app-store).

By now the applet should be published correctly, and you can use we itself to confirm that it is available as an applet to be installed in any we group.
