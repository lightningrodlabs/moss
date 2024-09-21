<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [WeaveServices](./api.weaveservices.md) &gt; [requestBind](./api.weaveservices.requestbind.md)

## WeaveServices.requestBind property

Request the applet holding the destination WAL (dstWal) to bind the source WAL (srcWal) to it. The source WAL must belong to the requesting applet.

**Signature:**

```typescript
requestBind: (srcWal: WAL, dstWal: WAL) => Promise<void>;
```