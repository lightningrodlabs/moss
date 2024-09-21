<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [@theweave/api](./api.md) &gt; [AppletView](./api.appletview.md)

## AppletView type

**Signature:**

```typescript
export type AppletView = {
    type: 'main';
} | {
    type: 'block';
    block: string;
    context: any;
} | {
    type: 'asset';
    recordInfo?: RecordInfo;
    wal: WAL;
} | {
    type: 'creatable';
    name: CreatableName;
    resolve: (wal: WAL) => Promise<void>;
    reject: (reason: any) => Promise<void>;
    cancel: () => Promise<void>;
};
```
**References:** [RecordInfo](./api.recordinfo.md)<!-- -->, [WAL](./api.wal.md)<!-- -->, [CreatableName](./api.creatablename.md)
