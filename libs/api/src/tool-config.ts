/**
 * Contents of a Tool's `weave.config.json`, shipped at the root of its UI
 * assets. Moss reads it from the webhapp when the Tool is installed into a
 * group and, for a running dev UI, from the UI dev server.
 */
export type ToolWeaveConfig = {
  /**
   * Whether the Tool's UI supports the cross-group view.
   */
  crossGroupView?: boolean;
  /**
   * Install-time options Moss renders as form fields in the install dialog.
   * Each writes one key of one role's DNA properties. Values are fixed at
   * install and identical for every member of the instance.
   */
  installOptions?: ToolInstallOption[];
};

export type ToolInstallOptionBase = {
  /** Role in the happ manifest whose DNA properties this option writes. */
  role: string;
  /** Key within that role's properties. `role` + `property` identify the option. */
  property: string;
  /** Field label shown to the installer. */
  label: string;
  /** Help text shown under the field. */
  description?: string;
  /** A required option must hold a valid value before the Tool can be installed. */
  required: boolean;
};

export type ToolInstallOptionChoice<T extends string | number> = { value: T; label: string };

/**
 * One install option. An empty field on an optional option leaves the
 * property as the happ manifest has it; only a `nullable` option writes
 * `null` when empty.
 */
export type ToolInstallOption = ToolInstallOptionBase &
  (
    | { kind: 'boolean'; default?: boolean }
    | {
        kind: 'stringChoice';
        choices: ToolInstallOptionChoice<string>[];
        default?: string | null;
        nullable?: boolean;
      }
    | {
        kind: 'numberChoice';
        choices: ToolInstallOptionChoice<number>[];
        default?: number | null;
        nullable?: boolean;
      }
    | {
        kind: 'string';
        minLength?: number;
        maxLength: number;
        default?: string | null;
        nullable?: boolean;
      }
    | {
        kind: 'number';
        min: number;
        max: number;
        integer: boolean;
        default?: number | null;
        nullable?: boolean;
      }
    | {
        kind: 'agentList';
        minItems?: number;
        maxItems?: number;
        nullable?: boolean;
      }
  );

export type ToolInstallOptionKind = ToolInstallOption['kind'];
