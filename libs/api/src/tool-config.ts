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

/**
 * Text shown to the installer. A plain string is used in every locale. A map
 * keyed by language tag (`en`, `de`, `pt-BR`, ...) lets Moss pick the
 * installer's language, falling back to the language alone, then `en`, then
 * the first entry.
 */
export type LocalizedText = string | Record<string, string>;

export type ToolInstallOptionBase = {
  /** Role in the happ manifest whose DNA properties this option writes. */
  role: string;
  /** Key within that role's properties. `role` + `property` identify the option. */
  property: string;
  /** Field label shown to the installer. */
  label: LocalizedText;
  /** Help text shown under the field. */
  description?: LocalizedText;
  /** A required option must hold a valid value before the Tool can be installed. */
  required: boolean;
  /**
   * Conditions that must all hold for this option to apply. An option whose
   * conditions fail is not shown, not checked, and written as if empty.
   * Each condition must name an option declared earlier in the list.
   */
  dependsOn?: ToolInstallOptionCondition[];
};

/**
 * A test on another install option's value. With neither `equals` nor `in`,
 * it holds when that option is filled in: `true` for a boolean, non-empty
 * for a list, and set and not `null` for the other kinds. A condition on an
 * option that does not apply never holds.
 */
export type ToolInstallOptionCondition = {
  /** Role of the option tested. Defaults to the dependent option's role. */
  role?: string;
  /** Property of the option tested. */
  property: string;
  /** Holds when the value equals this, or for a list, contains it. */
  equals?: boolean | string | number;
  /** Holds when the value equals one of these, or for a list, contains one. */
  in?: Array<string | number>;
};

export type ToolInstallOptionChoice<T extends string | number> = {
  value: T;
  label: LocalizedText;
};

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
        kind: 'stringChoiceList';
        choices: ToolInstallOptionChoice<string>[];
        minItems?: number;
        maxItems?: number;
        default?: string[] | null;
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
