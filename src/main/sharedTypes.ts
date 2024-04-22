export const TOOLS_LIBRARY_APP_ID = 'ToolsLibrary';

// ATTENTION: If this type is changed, the same type in src/renderer/types needs to be changed as well.
export type AppHashes =
  | {
      type: 'webhapp';
      sha256: string;
      happ: {
        sha256: string;
      };
      ui: {
        sha256: string;
      };
    }
  | {
      type: 'happ';
      sha256: string;
    };
