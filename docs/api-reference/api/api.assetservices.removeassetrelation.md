<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [AssetServices](./api.assetservices.md) &gt; [removeAssetRelation](./api.assetservices.removeassetrelation.md)

## AssetServices.removeAssetRelation property

Removes an asset relation and all its tags. This function deliberately returns no value because Tool frontends should subscribe to the AssetStore(s) to update their frontend state.

**Signature:**

```typescript
removeAssetRelation: (relationHash: EntryHash) => Promise<void>;
```
