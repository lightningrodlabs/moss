<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [CreatableResult](./api.creatableresult.md)

## CreatableResult type

**Signature:**

```typescript
export type CreatableResult = {
    type: 'success';
    wal: WAL;
} | {
    type: 'cancel';
} | {
    type: 'error';
    error: any;
};
```
**References:** [WAL](./api.wal.md)

