# Moss

Moss is a runtime for peer-to-peer collaboration Tools. People form Groups, and each Group installs Tools that its members use together.

## Language

### Groups and Tools

**Group**:
A private peer-to-peer network of people that share a set of installed Tools.
_Avoid_: space, community, workspace

**Tool**:
A packaged collaboration app that a Group can install. Different versions of one Tool share a Tool compatibility id.
_Avoid_: app, happ, plugin

**Applet**:
One installed instance of a Tool inside one Group.
_Avoid_: tool instance, app

**WAL** (Weave Asset Locator):
An address for one asset inside an Applet, made of an HRL and an optional context.
_Avoid_: link, asset url

### Hosting Applets

**Applet iframe**:
The sandboxed frame in which Moss renders one view of an Applet, identified by its `applet://` origin.

**Cross-group view**:
A frame that renders one Tool across every Group in which it is installed, identified by its `cross-group://` origin.
_Avoid_: cross-applet view

**Iframe kind**:
The verified identity of a frame that sends a message to Moss: an Applet or a Cross-group view. Moss derives it from the frame's origin, never from what the frame claims.
_Avoid_: source, sender

**WAL window**:
A separate operating-system window that shows one WAL outside the main window.
_Avoid_: popout, asset window

**Applet channel**:
The message link between Moss and the Applet iframes and Cross-group views it hosts. It carries requests from frames to Moss and messages from Moss to frames.
_Avoid_: postMessage bridge, iframe messaging

**Ready**:
The state of an Applet iframe after it reports that it can answer messages from Moss.

**Signing scope**:
The set of Applets whose cells a frame may sign zome calls for. An Applet iframe may sign for its own Applet only. A Cross-group view may sign for every Applet of its Tool.
