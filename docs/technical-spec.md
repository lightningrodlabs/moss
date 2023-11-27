
# Ontology

- Applets
	- Identified by the hash of the applet entry all throughout the code.
	- `AppletStore` is a TS class that given an applet exposes relevant queries.
- Applet Bundles
  - Identified by appletBundleHash which is the hash of the AppEntry in the appstore.
	- `AppletBundlesStore` is a TS class that can fetch or install applet bundles.
- Groups
  - Identified by the groupDnaHash.
	- `GroupStore` is a TS class that given a group exposes relevant queries.

# BELOW HERE OUTDATED
# We <-> Applet communication

- Applets are renderered inside iframes.
	- Iframes offer us security guarantees necessary to be able to install and experiment with applets from the devhub that may or may not be 100% trustable.
  - Iframes have a src url, if an iframe and its parent don't share the same origin, they can only send messages to each other, they can't access variables or execute functions from each other.
	- We can control the sandboxed security mechanisms for iframes.
	  - https://www.w3schools.com/tags/att_iframe_sandbox.asp

- Origin for iframes looks like `applet://BASE64_APPLET_HASH`.
  - In Http, the origin is the part that goes between http:// and the first /.
	  - Eg, in https://subdomain.lightingrodlabs.org/we the origin is subdomain.lightningrodlabs.we
		- Http as a protocol takes the origin to be the "author" and "authority" of that website's resources.
		- It will prevent calls with `fetch` to other origins by default.

- When we wants to render an applet, it just renders an iframe with the applet's hash in it's origin.

- Two big patterns when this happens:
	- When we is started, it renders an invisble iframe for each applet that the user has installed.
	  - This iframe is used for non-rendering purposes, like getting the attachment types or executing search calls, notifications...
	- When the user clicks on an applet, there is an iframe for that applet that opens in a new tab.
	  - Two contexts:
		  - Applet views:
	  	  - Main: when the user clicks on an applet available inside a group.
		  	- Block: when the user creates a custom view.
				- Entries: when the user clicks on an HRL.
			- Cross applet views:
			  - Main: when the user clicks on the top bar applet logo.
				- Block: not used anywhere yet.
		- To signify that this iframe needs to actually render something, query parameters are appended in the URL
		  - Query parameters are HTTP parameters that don't change the origin but add information to the server about what to return.
		  - Eg: the src URL for the applet might be `applet://BASE64_APPLET_HASH?view=applet-view&view-type=main`.

- When an iframe is rendered, what is first executed inside of it is the javascript file output of `ui/applet-iframe`.
  - This package defines the communication protocol between We (host) and applet (guest).
  - The first thing that this javascript file does is fetch the `WeApplet` default export that the applet has compiled in `index.js`.
		- This is done via an `import(/index.js)` which eventually hits one of these two:
		  - Linux/MacOs: `register_uri_scheme_protocol`, a tauri based API that intercepts the http request, reads the asset from the applet .webhapp UI, and returns the asset.
			- Windows: it hits a locally running server that gets executed at `http://BASE64_APPLET_HASH.localhost`, reads the asset from the applet .webhapp UI, and returns the asset.
		- With this, we also get the benefit that the applet's UI can fetch assets just with normal `fetch` requests or image sources.

- The possible messages from parent to applet and viceversa are defined in `ui/applet-messages`.

- The initial iframe also requests a `styles.css` stylesheet from the applet's UI.


# How to upgrade the holochain version.

1. Go into Cargo.toml and change it.
2. Go into `src-tauri/Cargo.toml` and change it as well.
3. Make sure the way to launch the conductor in `src-tauri/src/launch.rs` still works.

# How to create a new We release.

1. Search for all the instances of the previous release tag (they are of the form `v0.0.20`).
2. Replace them with the new version tag.
3. Commit and push the changes.
4. Create a new version tag with `git tag v0.0.20`.
5. Push the tags with `git push --tags`.
6. A release github action is gonna be created for this tag.
