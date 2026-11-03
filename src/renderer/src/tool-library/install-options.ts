import type { ToolInstallOption } from '@theweave/api';
import type { RoleProperties } from '@theweave/moss-types';

/**
 * Install-option logic with no DOM dependencies: checking a Tool's
 * declarations, seeding field values, validating what the installer
 * entered, and merging the result into a role's DNA properties.
 */

/** A field's value; `null` is only valid for a nullable option. */
export type InstallOptionValue = boolean | string | number | string[] | null;

/** Values keyed by `optionKey`; `undefined` means the field is empty. */
export type InstallOptionValues = Record<string, InstallOptionValue | undefined>;

export function optionKey(option: ToolInstallOption): string {
  return `${option.role}/${option.property}`;
}

export type DeclarationProblem = {
  code:
    | 'unknown-role'
    | 'duplicate'
    | 'bad-range'
    | 'bad-length'
    | 'bad-items'
    | 'bad-choices'
    | 'bad-default'
    | 'required-nullable';
  role: string;
  property: string;
};

/** Why a value is not acceptable; bounded problems carry the bound they broke. */
export type ValueProblem =
  | { code: 'required' | 'wrong-type' | 'not-a-choice' | 'not-integer' }
  | {
      code: 'too-short' | 'too-long' | 'below-min' | 'above-max' | 'too-few' | 'too-many';
      limit: number;
    };

function isNullable(option: ToolInstallOption): boolean {
  return option.kind !== 'boolean' && option.nullable === true;
}

function isListKind(option: ToolInstallOption): boolean {
  return option.kind === 'agentList' || option.kind === 'stringChoiceList';
}

function declaredDefault(option: ToolInstallOption): InstallOptionValue | undefined {
  return option.kind === 'agentList' ? undefined : option.default;
}

/**
 * Returns the first problem that makes the declarations unusable, or
 * `undefined` when a form can be rendered from them.
 */
export function checkDeclarations(
  options: ToolInstallOption[],
  roleNames: string[],
): DeclarationProblem | undefined {
  const seen = new Set<string>();
  for (const option of options) {
    const problem = (code: DeclarationProblem['code']): DeclarationProblem => ({
      code,
      role: option.role,
      property: option.property,
    });
    if (!roleNames.includes(option.role)) return problem('unknown-role');
    const key = optionKey(option);
    if (seen.has(key)) return problem('duplicate');
    seen.add(key);

    switch (option.kind) {
      case 'number':
        if (option.min > option.max) return problem('bad-range');
        break;
      case 'string':
        if ((option.minLength ?? 0) > option.maxLength) return problem('bad-length');
        break;
      case 'agentList':
        if (
          option.minItems !== undefined &&
          option.maxItems !== undefined &&
          option.minItems > option.maxItems
        )
          return problem('bad-items');
        break;
      case 'stringChoiceList':
      case 'stringChoice':
      case 'numberChoice': {
        const values = option.choices.map((choice) => choice.value);
        if (values.length === 0 || new Set(values).size !== values.length)
          return problem('bad-choices');
        if (option.kind === 'stringChoiceList') {
          const min = option.minItems ?? 0;
          if (min > values.length || (option.maxItems !== undefined && min > option.maxItems))
            return problem('bad-items');
        }
        break;
      }
      case 'boolean':
        break;
    }

    if (option.required && isNullable(option)) return problem('required-nullable');

    const fallback = declaredDefault(option);
    if (fallback === null && !isNullable(option)) return problem('bad-default');
    if (fallback !== undefined && fallback !== null) {
      // A default must satisfy the option's own constraints; `required`
      // is irrelevant here because a default is by definition present.
      if (validateValue({ ...option, required: false }, fallback)) return problem('bad-default');
    }
  }
  return undefined;
}

function matchesKind(option: ToolInstallOption, value: unknown): value is InstallOptionValue {
  switch (option.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
    case 'stringChoice':
      return typeof value === 'string';
    case 'number':
    case 'numberChoice':
      return typeof value === 'number';
    case 'agentList':
    case 'stringChoiceList':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
}

/**
 * Seeds each field: the declaration default, else the manifest's value
 * for that key when its type fits, else the kind's empty state.
 */
export function initialValues(
  options: ToolInstallOption[],
  manifestDefaults: RoleProperties,
): InstallOptionValues {
  const values: InstallOptionValues = {};
  for (const option of options) {
    const key = optionKey(option);
    const declared = declaredDefault(option);
    if (declared !== undefined) {
      values[key] = declared;
      continue;
    }
    const fromManifest = manifestDefaults[option.role]?.[option.property];
    if (matchesKind(option, fromManifest)) {
      values[key] = fromManifest;
    } else if (option.kind === 'boolean') {
      values[key] = false;
    } else if (isListKind(option)) {
      values[key] = [];
    } else if (isNullable(option)) {
      values[key] = null;
    } else {
      values[key] = undefined;
    }
  }
  return values;
}

/** True when the field counts as empty for `required` and merge purposes. */
export function isUnset(option: ToolInstallOption, value: InstallOptionValue | undefined): boolean {
  if (value === undefined) return true;
  if (isListKind(option) && Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function validateValue(
  option: ToolInstallOption,
  value: InstallOptionValue | undefined,
): ValueProblem | undefined {
  if (isUnset(option, value)) return option.required ? { code: 'required' } : undefined;
  if (value === null) return isNullable(option) ? undefined : { code: 'wrong-type' };
  if (!matchesKind(option, value)) return { code: 'wrong-type' };

  switch (option.kind) {
    case 'boolean':
      return undefined;
    case 'stringChoice':
    case 'numberChoice':
      return option.choices.some((choice) => choice.value === value)
        ? undefined
        : { code: 'not-a-choice' };
    case 'string': {
      const text = value as string;
      const minLength = option.minLength ?? 0;
      if (text.length < minLength) return { code: 'too-short', limit: minLength };
      if (text.length > option.maxLength) return { code: 'too-long', limit: option.maxLength };
      return undefined;
    }
    case 'number': {
      const n = value as number;
      if (option.integer && !Number.isInteger(n)) return { code: 'not-integer' };
      if (n < option.min) return { code: 'below-min', limit: option.min };
      if (n > option.max) return { code: 'above-max', limit: option.max };
      return undefined;
    }
    case 'stringChoiceList':
    case 'agentList': {
      const list = value as string[];
      if (option.kind === 'stringChoiceList') {
        const allowed = option.choices.map((choice) => choice.value);
        if (
          new Set(list).size !== list.length ||
          !list.every((item) => allowed.includes(item))
        )
          return { code: 'not-a-choice' };
      }
      if (option.minItems !== undefined && list.length < option.minItems)
        return { code: 'too-few', limit: option.minItems };
      if (option.maxItems !== undefined && list.length > option.maxItems)
        return { code: 'too-many', limit: option.maxItems };
      return undefined;
    }
  }
}

/**
 * Overlays the chosen values on the base properties per role. An unset
 * option leaves its key as the base has it, unless the option is nullable,
 * in which case the key is written as `null`.
 */
export function mergeProperties(
  base: RoleProperties,
  options: ToolInstallOption[],
  values: InstallOptionValues,
): RoleProperties {
  const merged: RoleProperties = Object.fromEntries(
    Object.entries(base).map(([role, props]) => [role, { ...props }]),
  );
  for (const option of options) {
    const value = values[optionKey(option)];
    const unset = isUnset(option, value);
    if (unset && !isNullable(option)) continue;
    merged[option.role] = merged[option.role] ?? {};
    merged[option.role][option.property] = unset ? null : inDeclarationOrder(option, value);
  }
  return merged;
}

/** Orders a choice-list selection by its choices, so equal selections write equal bytes. */
function inDeclarationOrder(
  option: ToolInstallOption,
  value: InstallOptionValue | undefined,
): InstallOptionValue | undefined {
  if (option.kind !== 'stringChoiceList' || !Array.isArray(value)) return value;
  return option.choices.map((choice) => choice.value).filter((v) => value.includes(v));
}

type ChoiceOption = Extract<ToolInstallOption, { kind: 'stringChoice' | 'numberChoice' }>;

/**
 * Select controls carry each choice by its index, not its value, because
 * Shoelace rewrites option values that contain spaces. These two map
 * between the index string the control reports and the typed choice value.
 */
export function choiceAtIndex(option: ChoiceOption, selected: string): string | number | undefined {
  if (selected === '') return undefined;
  const index = Number(selected);
  return Number.isInteger(index) ? option.choices[index]?.value : undefined;
}

export function indexOfChoice(option: ChoiceOption, value: InstallOptionValue | undefined): string {
  const index = option.choices.findIndex((choice) => choice.value === value);
  return index === -1 ? '' : String(index);
}

type ChoiceListOption = Extract<ToolInstallOption, { kind: 'stringChoiceList' }>;

/** Multi-select counterpart of `choiceAtIndex`; returns values in declaration order. */
export function choicesAtIndices(option: ChoiceListOption, selected: string[]): string[] {
  const indices = new Set(selected.map(Number));
  return option.choices.filter((_, index) => indices.has(index)).map((choice) => choice.value);
}

/** Multi-select counterpart of `indexOfChoice`. */
export function indicesOfChoices(
  option: ChoiceListOption,
  value: InstallOptionValue | undefined,
): string[] {
  if (!Array.isArray(value)) return [];
  return option.choices.flatMap((choice, index) =>
    value.includes(choice.value) ? [String(index)] : [],
  );
}
