<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [OpenViewRequest](./api.openviewrequest.md)

## OpenViewRequest type

**Signature:**

```typescript
export type OpenViewRequest = {
    type: 'applet-main';
    appletHash: EntryHash;
} | {
    type: 'cross-applet-main';
    appletBundleId: ActionHash;
} | {
    type: 'applet-block';
    appletHash: EntryHash;
    block: string;
    context: any;
} | {
    type: 'cross-applet-block';
    appletBundleId: ActionHash;
    block: string;
    context: any;
} | {
    type: 'wal';
    wal: WAL;
    mode?: OpenWalMode;
};
```
**References:** [WAL](./api.wal.md)<!-- -->, [OpenWalMode](./api.openwalmode.md)
