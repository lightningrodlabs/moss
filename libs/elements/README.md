# @theweave/elements

This package contains common UI elements for Weave tools to use Weave Asset Locators (WALs) and for Holochain hApps to know if they are in a Weave context or not.


## `wal-embed`

An element for embedding a WAL in an iFrame.

Example use in a lit-element based hApp:

``` html
<wal-embed
    style="margin-top: 20px;"
    src=${this.walEmbedLink}
    ?bare=${this.bare}
    closable
    @open-in-sidebar=${() => console.log('Opening in sidebar')}
    @close=${() => console.log('Closing requested')}
    ></wal-embed>

```

## `wal-to-pocket`

## `share-wal`

## `weave-client-context`