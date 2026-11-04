import type { ToolInstallOption, ToolInstallOptionCondition } from '@theweave/api';
import {
  DeclarationProblem,
  InstallOptionValue,
  InstallOptionValues,
  isUnset,
  optionKey,
} from './install-options.js';

/**
 * `dependsOn` logic: which options apply given the current values, and
 * whether a Tool's conditions make sense. An option that does not apply is
 * hidden, not checked, and written as if empty.
 */

function targetKey(option: ToolInstallOption, condition: ToolInstallOptionCondition): string {
  return `${condition.role ?? option.role}/${condition.property}`;
}

type ConditionValue = boolean | string | number;

/** Whether `value` is something `target` could hold, as a single item. */
function fitsTarget(target: ToolInstallOption, value: ConditionValue): boolean {
  switch (target.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'stringChoice':
    case 'numberChoice':
    case 'stringChoiceList':
      return target.choices.some((choice) => choice.value === value);
    case 'agentList':
      return false;
  }
}

function conditionIsSound(
  target: ToolInstallOption,
  condition: ToolInstallOptionCondition,
): boolean {
  const { equals, in: oneOf } = condition;
  if (equals !== undefined && oneOf !== undefined) return false;
  if (equals !== undefined) return fitsTarget(target, equals);
  if (oneOf !== undefined) {
    if (target.kind === 'boolean' || oneOf.length === 0) return false;
    return oneOf.every((value) => fitsTarget(target, value));
  }
  return true;
}

/**
 * Returns the first option whose conditions cannot work: a target that is
 * missing or not declared before it, or a test value its target could
 * never hold.
 */
export function checkConditions(options: ToolInstallOption[]): DeclarationProblem | undefined {
  const earlier = new Map<string, ToolInstallOption>();
  for (const option of options) {
    for (const condition of option.dependsOn ?? []) {
      const target = earlier.get(targetKey(option, condition));
      if (!target || !conditionIsSound(target, condition))
        return { code: 'bad-condition', role: option.role, property: option.property };
    }
    earlier.set(optionKey(option), option);
  }
  return undefined;
}

function holds(
  target: ToolInstallOption,
  condition: ToolInstallOptionCondition,
  value: InstallOptionValue | undefined,
): boolean {
  if (isUnset(target, value) || value === null) return false;
  const wanted: ConditionValue[] | undefined =
    condition.equals !== undefined ? [condition.equals] : condition.in;
  if (wanted === undefined) return target.kind === 'boolean' ? value === true : true;
  if (Array.isArray(value)) return wanted.some((item) => value.includes(item as string));
  return wanted.includes(value as ConditionValue);
}

/**
 * Keys of the options that apply. Options are visited in declaration order,
 * and a condition only names earlier options, so a target's own activity is
 * known before it is tested. A condition on an inactive target fails.
 */
export function activeOptionKeys(
  options: ToolInstallOption[],
  values: InstallOptionValues,
): Set<string> {
  const byKey = new Map(options.map((option) => [optionKey(option), option]));
  const active = new Set<string>();
  for (const option of options) {
    const applies = (option.dependsOn ?? []).every((condition) => {
      const key = targetKey(option, condition);
      const target = byKey.get(key);
      return target !== undefined && active.has(key) && holds(target, condition, values[key]);
    });
    if (applies) active.add(optionKey(option));
  }
  return active;
}

/** The values with every inactive option emptied, ready to merge. */
export function withoutInactive(
  options: ToolInstallOption[],
  values: InstallOptionValues,
): InstallOptionValues {
  const active = activeOptionKeys(options, values);
  const result: InstallOptionValues = { ...values };
  for (const option of options) {
    const key = optionKey(option);
    if (!active.has(key)) result[key] = undefined;
  }
  return result;
}
