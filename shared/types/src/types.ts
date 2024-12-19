import { ActionHashB64, AgentPubKeyB64, DnaHashB64, EntryHashB64 } from '@holochain/client';
import { Type, Static } from '@sinclair/typebox';

export type PartialModifiers = {
  networkSeed: string;
  progenitor: AgentPubKeyB64 | null;
};

export type WebHappSource = {
  type: 'https';
  url: string;
};

/**
 * An ID to determine which Tool instances belong to the same compatible Tool class.
 * It is derived from the URL of the developer collective Tool list where it had been
 * pubished, as well as its tool Id and versionBranch in that list.
 */
export type ToolCompatibilityId = string;

export const TAppHashes = Type.Union([
  Type.Object(
    {
      type: Type.Literal('webhapp'),
      sha256: Type.String(),
      happ: Type.Object(
        {
          sha256: Type.String(),
        },
        { additionalProperties: false },
      ),
      ui: Type.Object(
        {
          sha256: Type.String(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('happ'),
      sha256: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export type AppHashes = Static<typeof TAppHashes>;

export type DistributionInfo =
  | {
      type: 'tools-library';
      info: {
        toolsLibraryDnaHash: DnaHashB64;
        /**
         * Action Hash B64 of the original Tool entry
         */
        originalToolActionHash: ActionHashB64;
        /**
         * ActionHashB64 of the (updated) Tool entry this applet has been installed from
         */
        toolVersionActionHash: ActionHashB64;
        toolVersionEntryHash: EntryHashB64;
      };
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    }
  | {
      type: 'web2-tool-list';
      info: {
        /**
         * Web2 URL to the developer collective's list of apps
         */
        toolListUrl: string;
        /**
         * ID of the developer collective
         */
        developerCollectiveId: string;
        /**
         * ID of the Tool
         */
        toolId: string;
        /**
         * Name of the Tool
         */
        toolName: string;
        /**
         * Version branch of the tool
         */
        versionBranch: string;
        /**
         * Specific version of the Tool
         */
        toolVersion: string;
        /**
         * Id derived from toolListUrl + toolId + versionBranch
         */
        toolCompatibilityId: string;
      };
    }
  | {
      type: 'default-app'; // Shipped with the Moss executable by default
    };

export const TDistributionInfo = Type.Union([
  Type.Object(
    {
      type: Type.Literal('tools-library'),
      info: Type.Object({
        toolsLibraryDnaHash: Type.String(),
        originalToolActionHash: Type.String(),
        toolVersionActionHash: Type.String(),
        toolVersionEntryHash: Type.String(),
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('web2-tool-list'),
      info: Type.Object({
        toolListUrl: Type.String(),
        developerCollectiveId: Type.String(),
        toolId: Type.String(),
        versionBranch: Type.String(),
        toolVersion: Type.String(),
        toolCompatibilityId: Type.String(),
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('filesystem'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('default-app'),
    },
    { additionalProperties: false },
  ),
]);

export type AppAssetsInfo =
  | {
      type: 'happ';
      assetSource: AssetSource; // Source of the actual asset bytes
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256: string; // sha256 hash of the .happ file
    }
  | {
      type: 'webhapp';
      assetSource: AssetSource;
      distributionInfo: DistributionInfo; // Info about the distribution channel (e.g. appstore hashes)
      sha256?: string; // sha256 hash of the .webhapp file
      happ: {
        sha256: string; // sha256 hash of the .happ file. Will also define the name of the .happ file
        dnas?: any; // sha256 hashes of dnas and zomes
      };
      ui: {
        location:
          | {
              type: 'filesystem';
              sha256: string; // Also defines the foldername where the unzipped assets are stored
            }
          | {
              type: 'localhost';
              port: number;
            };
      };
    };

export type AssetSource =
  | {
      type: 'https';
      url: string;
    }
  | {
      type: 'filesystem'; // Installed from filesystem
    }
  | {
      type: 'default-app'; // Shipped with the We executable by default
    };

/**
 * ==================================================================
 * Types to be used for web2 based Tool curations
 * ==================================================================
 */

export function defineCurationLists(content: ToolCurations) {
  return content;
}

export function defineDevCollectiveToolList(content: DeveloperCollectiveToolList) {
  return content;
}

/**
 * A Tool curation is an opinionated list of developer collectives and Tools
 * thereof that are to be shown as part of this curation.
 */
export type ToolCurations = {
  /**
   * The curator of the curation lists
   */
  curator: ToolCurator;
  /**
   * Curated lists of Tools
   */
  curationLists: Record<string, ToolCurationList>;
};

export type ToolCurator = {
  /**
   * The name of the curator
   */
  name: string;
  /**
   * Description of the curation
   */
  description: string;
  /**
   * Contact information of the curator
   */
  contact: {
    website?: string;
    email?: string;
  };
  /**
   * String in a format that can be used in an src atribute of an html <img/> tag
   */
  icon: string;
};

/**
 * A curation of a developer collective's Tools
 */
export type ToolCurationList = {
  /**
   * Name of the curation
   */
  name: string;
  /**
   * Description of the curation
   */
  description: string;
  /**
   * Tags
   */
  tags: string[];
  /**
   * List of curated Tools
   */
  tools: CuratedTool[];
};

export type CuratedTool = {
  /**
   * URL to the Tool list
   */
  toolListUrl: string;
  /**
   * ID of the Tool
   */
  toolId: string;
  /**
   * version branch of the Tool
   */
  versionBranch: string;
  /**
   * Tags
   */
  tags: string[];
};

export type DeveloperCollectiveToolList = {
  developerCollective: DeveloperCollecive;
  tools: Array<ToolInfoAndVersions>;
};

export type DeveloperCollecive = {
  /**
   * ID of the developer collective. No whitespaces.
   *
   * MUST NOT BE CHANGED ONCE PUBLISHED.
   */
  id: string;
  /**
   * Name of the developer collective
   */
  name: string;
  description: string;
  contact: {
    website?: string;
    email?: string;
  };
  /**
   * String in a format that can be used in an src attribute of an html <img/> tag
   */
  icon: string;
};

export type ToolInfoAndVersions = {
  /**
   * Id of the Tool. No whitespaces.
   *
   * MUST NOT BE CHANGED ONCE PUBLISHED.
   */
  id: string;
  /**
   * This field will be used by Moss in order to determine
   * whether different instances of Tools with the same id
   * are compatible with each other.
   *
   * MUST NOT BE CHANGED ONCE PUBLISHED.
   */
  versionBranch: string;
  /**
   * The title of the app as shown in the Tool library
   */
  title: string;
  /**
   * The subtitle of the app as shown in the Tool library
   */
  subtitle: string;
  /**
   * The description of the app as shown in the Tool library
   */
  description: string;
  /**
   * String in a format that can be used in an src atribute of an html <img/> tag
   */
  icon: string;
  /**
   * Tags that may be used in Tool libraries
   */
  tags: string[];
  /**
   * Available versions for this app
   */
  versions: ToolVersionInfo[];
  /**
   * If this Tool should be deprecated, add a deprecation reason here.
   */
  deprecation?: string;
};

export type ToolVersionInfo = {
  /**
   * MUST NOT BE CHANGED AFTER PUBLISHING
   *
   * A semver version string. When Moss checks for updates, it will always take
   * the highest version according to semver, irrespective of the release date.
   */
  version: string;
  /**
   * MUST NOT BE CHANGED AFTER PUBLISHING
   *
   * Sha256 hashes of the Tool
   */
  hashes: {
    webhappSha256: string;
    happSha256: string;
    uiSha256: string;
  };
  /**
   * URL to the webhapp file
   */
  url: string;
  /**
   * Changes introduced with this version
   */
  changelog: string;
  /**
   * Date when this Tool version was released
   */
  releasedAt: number;
};

export type PasswordType =
  | {
      type: 'user-provided';
      password: string;
    }
  | {
      type: 'random';
    };
