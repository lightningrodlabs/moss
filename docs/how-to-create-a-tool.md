# Weave Tool

A _Weave_ Tool is a Holochain application and associated UI that's only intended to be used inside a Weave `Frame` environment. This means that the UI, instead of rendering a full blown web application, only renders the appropriate elements that the `Frame` requests.

**Nomenclature Caveat**: In this document we refer to a `Frame` which is the general term for a runtime that implements the [Weave Interaction Pattern](https://theweave.social/#technical). _Moss_ is a reference implementation of a `Frame`. You may also see the term `applet` in some code libraries which is a remnant of the term "Tool" and will be phased out over time.

At the technical level, a Weave Tool is just a normal Holochain `.webhapp`, with 2 main differences from any other web hApp:

- UI code:

  - Your UI code may offer different rendering modes or UI widgets as well as offer the affordances described by the [Weave Interaction Pattern](https://theweave.social/#technical) (search, attachments, embedding, notification, etc.)

- hApp code:
  - You don't need the profiles zome or any other zome that deals with profiles, as they will be managed by the we group DNA.

## How to create a Tool

Check out the [README](../libs/we-applet/README.md) of the `@lightningrodlabs/we-applet` npm package for instructions on how to modify your hApp UI in order to become Weave compatible.
