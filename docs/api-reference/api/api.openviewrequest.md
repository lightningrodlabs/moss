<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [OpenViewRequest](./api.openviewrequest.md)

## OpenViewRequest type

**Signature:**

```typescript
export type OpenViewRequest = {
    type: 'applet-main';
    appletHash: EntryHash;
} | {
    type: 'cross-group-main';
    appletBundleId: string;
} | {
    type: 'applet-block';
    appletHash: EntryHash;
    block: string;
    context: any;
} | {
    type: 'cross-group-block';
    appletBundleId: string;
    block: string;
    context: any;
} | {
    type: 'asset';
    wal: WAL;
    mode?: OpenAssetMode;
};
```
**References:** [WAL](./api.wal.md)<!-- -->, [OpenAssetMode](./api.openassetmode.md)

