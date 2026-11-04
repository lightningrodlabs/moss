import { describe, it, expect } from 'vitest';
import type { ToolInstallOption, ToolInstallOptionCondition } from '@theweave/api';
import {
  activeOptionKeys,
  checkConditions,
  withoutInactive,
} from './install-option-conditions.js';

const stewarded: ToolInstallOption = {
  role: 'forum',
  property: 'stewarded',
  kind: 'boolean',
  label: 'Stewarded',
  required: false,
};
const theme: ToolInstallOption = {
  role: 'forum',
  property: 'theme',
  kind: 'stringChoice',
  label: 'Theme',
  required: false,
  choices: [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'custom', label: 'Custom' },
  ],
};
const categories: ToolInstallOption = {
  role: 'forum',
  property: 'categories',
  kind: 'stringChoiceList',
  label: 'Categories',
  required: false,
  choices: [
    { value: 'news', label: 'News' },
    { value: 'help', label: 'Help' },
  ],
};
const stewards: ToolInstallOption = {
  role: 'forum',
  property: 'stewards',
  kind: 'agentList',
  label: 'Stewards',
  required: false,
};
const motto: ToolInstallOption = {
  role: 'forum',
  property: 'motto',
  kind: 'string',
  label: 'Motto',
  required: false,
  maxLength: 40,
};
const maxPosts: ToolInstallOption = {
  role: 'forum',
  property: 'maxPosts',
  kind: 'number',
  label: 'Max posts',
  required: true,
  min: 1,
  max: 10,
  integer: true,
};

function dependent(...conditions: ToolInstallOptionCondition[]): ToolInstallOption {
  return { ...maxPosts, dependsOn: conditions };
}

describe('checkConditions', () => {
  const code = (options: ToolInstallOption[]) => checkConditions(options)?.code;

  it('accepts conditions on earlier options, with the role defaulted', () => {
    expect(code([stewarded, theme, dependent({ property: 'stewarded' })])).toBeUndefined();
    expect(
      code([theme, dependent({ role: 'forum', property: 'theme', equals: 'dark' })]),
    ).toBeUndefined();
    expect(code([theme, dependent({ property: 'theme', in: ['dark', 'custom'] })])).toBeUndefined();
  });

  it('names the dependent option in the problem', () => {
    expect(checkConditions([dependent({ property: 'nope' })])).toEqual({
      code: 'bad-condition',
      role: 'forum',
      property: 'maxPosts',
    });
  });

  it('rejects an unknown target, a later target, and itself', () => {
    expect(code([stewarded, dependent({ property: 'nope' })])).toBe('bad-condition');
    expect(code([dependent({ property: 'stewarded' }), stewarded])).toBe('bad-condition');
    expect(code([dependent({ property: 'maxPosts' })])).toBe('bad-condition');
    expect(code([stewarded, dependent({ role: 'other', property: 'stewarded' })])).toBe(
      'bad-condition',
    );
  });

  it('rejects equals and in together, and an empty in', () => {
    expect(code([theme, dependent({ property: 'theme', equals: 'dark', in: ['light'] })])).toBe(
      'bad-condition',
    );
    expect(code([theme, dependent({ property: 'theme', in: [] })])).toBe('bad-condition');
  });

  it('rejects values of the wrong type or outside the choices', () => {
    expect(code([stewarded, dependent({ property: 'stewarded', equals: 'yes' })])).toBe(
      'bad-condition',
    );
    expect(code([motto, dependent({ property: 'motto', equals: 3 })])).toBe('bad-condition');
    expect(code([theme, dependent({ property: 'theme', equals: 'blue' })])).toBe('bad-condition');
    expect(code([theme, dependent({ property: 'theme', in: ['dark', 'blue'] })])).toBe(
      'bad-condition',
    );
    expect(code([categories, dependent({ property: 'categories', equals: 'help' })])).toBe(
      undefined,
    );
  });

  it('rejects equals or in on an agent list, and in on a boolean', () => {
    expect(code([stewards, dependent({ property: 'stewards', equals: 'uhCAk' })])).toBe(
      'bad-condition',
    );
    expect(code([stewards, dependent({ property: 'stewards', in: ['uhCAk'] })])).toBe(
      'bad-condition',
    );
    expect(code([stewarded, dependent({ property: 'stewarded', in: ['x'] })])).toBe(
      'bad-condition',
    );
  });
});

describe('activeOptionKeys', () => {
  const isActive = (
    options: ToolInstallOption[],
    values: Record<string, unknown>,
    key = 'forum/maxPosts',
  ) => activeOptionKeys(options, values as never).has(key);

  it('treats an option without conditions as active', () => {
    expect(isActive([maxPosts], {})).toBe(true);
  });

  it('reads "filled in" per kind', () => {
    const on = (target: ToolInstallOption, value: unknown) =>
      isActive([target, dependent({ property: target.property })], {
        [`forum/${target.property}`]: value,
      });
    expect(on(stewarded, true)).toBe(true);
    expect(on(stewarded, false)).toBe(false);
    expect(on(motto, 'hi')).toBe(true);
    expect(on(motto, undefined)).toBe(false);
    expect(on(motto, null)).toBe(false);
    expect(on(stewards, [])).toBe(false);
    expect(on(stewards, ['uhCAk'])).toBe(true);
  });

  it('matches equals and in on scalar and list targets', () => {
    const eq = [theme, dependent({ property: 'theme', equals: 'dark' })];
    expect(isActive(eq, { 'forum/theme': 'dark' })).toBe(true);
    expect(isActive(eq, { 'forum/theme': 'light' })).toBe(false);
    const inn = [theme, dependent({ property: 'theme', in: ['dark', 'custom'] })];
    expect(isActive(inn, { 'forum/theme': 'custom' })).toBe(true);
    expect(isActive(inn, { 'forum/theme': 'light' })).toBe(false);
    const list = [categories, dependent({ property: 'categories', in: ['help'] })];
    expect(isActive(list, { 'forum/categories': ['news', 'help'] })).toBe(true);
    expect(isActive(list, { 'forum/categories': ['news'] })).toBe(false);
    const listEq = [categories, dependent({ property: 'categories', equals: 'news' })];
    expect(isActive(listEq, { 'forum/categories': ['news'] })).toBe(true);
  });

  it('requires every condition', () => {
    const options = [
      stewarded,
      theme,
      dependent({ property: 'stewarded' }, { property: 'theme', equals: 'dark' }),
    ];
    expect(isActive(options, { 'forum/stewarded': true, 'forum/theme': 'dark' })).toBe(true);
    expect(isActive(options, { 'forum/stewarded': false, 'forum/theme': 'dark' })).toBe(false);
  });

  it('turns off a whole chain when its root turns off', () => {
    const middle: ToolInstallOption = { ...motto, dependsOn: [{ property: 'stewarded' }] };
    const options = [stewarded, middle, dependent({ property: 'motto' })];
    expect(isActive(options, { 'forum/stewarded': true, 'forum/motto': 'hi' })).toBe(true);
    expect(isActive(options, { 'forum/stewarded': false, 'forum/motto': 'hi' })).toBe(false);
  });
});

describe('withoutInactive', () => {
  it('empties inactive options and keeps the rest', () => {
    const options = [stewarded, dependent({ property: 'stewarded' })];
    expect(withoutInactive(options, { 'forum/stewarded': false, 'forum/maxPosts': 5 })).toEqual({
      'forum/stewarded': false,
      'forum/maxPosts': undefined,
    });
    expect(withoutInactive(options, { 'forum/stewarded': true, 'forum/maxPosts': 5 })).toEqual({
      'forum/stewarded': true,
      'forum/maxPosts': 5,
    });
  });
});
