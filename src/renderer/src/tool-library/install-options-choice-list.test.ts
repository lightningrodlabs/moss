import { describe, it, expect } from 'vitest';
import type { ToolInstallOption } from '@theweave/api';
import {
  checkDeclarations,
  choicesAtIndices,
  indicesOfChoices,
  initialValues,
  mergeProperties,
  validateValue,
} from './install-options.js';

type ChoiceListOption = Extract<ToolInstallOption, { kind: 'stringChoiceList' }>;

const categories: ChoiceListOption = {
  role: 'forum',
  property: 'categories',
  kind: 'stringChoiceList',
  label: 'Categories',
  required: false,
  choices: [
    { value: 'news', label: 'News' },
    { value: 'events', label: 'Events' },
    { value: 'help desk', label: 'Help desk' },
  ],
};

describe('stringChoiceList declarations', () => {
  const roles = ['forum'];

  it('accepts a plain declaration', () => {
    expect(checkDeclarations([categories], roles)).toBeUndefined();
  });

  it('reports empty or repeated choices', () => {
    expect(checkDeclarations([{ ...categories, choices: [] }], roles)?.code).toBe('bad-choices');
    const repeated = [
      { value: 'news', label: 'A' },
      { value: 'news', label: 'B' },
    ];
    expect(checkDeclarations([{ ...categories, choices: repeated }], roles)?.code).toBe(
      'bad-choices',
    );
  });

  it('reports minItems above maxItems or above the number of choices', () => {
    expect(checkDeclarations([{ ...categories, minItems: 2, maxItems: 1 }], roles)?.code).toBe(
      'bad-items',
    );
    expect(checkDeclarations([{ ...categories, minItems: 4 }], roles)?.code).toBe('bad-items');
  });

  it('reports a default that is not a choice, repeats, or breaks the bounds', () => {
    const bad = (option: ChoiceListOption) => checkDeclarations([option], roles)?.code;
    expect(bad({ ...categories, default: ['nope'] })).toBe('bad-default');
    expect(bad({ ...categories, default: ['news', 'news'] })).toBe('bad-default');
    expect(bad({ ...categories, maxItems: 1, default: ['news', 'events'] })).toBe('bad-default');
    expect(bad({ ...categories, default: ['news'] })).toBeUndefined();
  });
});

describe('stringChoiceList values', () => {
  it('seeds from the declared default, then the manifest, else empty', () => {
    const key = 'forum/categories';
    expect(initialValues([{ ...categories, default: ['help desk'] }], {})[key]).toEqual([
      'help desk',
    ]);
    expect(initialValues([categories], { forum: { categories: ['events'] } })[key]).toEqual([
      'events',
    ]);
    expect(initialValues([categories], { forum: { categories: [1] } })[key]).toEqual([]);
    expect(initialValues([categories], {})[key]).toEqual([]);
  });

  it('requires at least one item when required', () => {
    expect(validateValue({ ...categories, required: true }, [])).toEqual({ code: 'required' });
    expect(validateValue(categories, [])).toBeUndefined();
  });

  it('rejects a non-choice, a repeat, and a wrong type', () => {
    expect(validateValue(categories, ['nope'])).toEqual({ code: 'not-a-choice' });
    expect(validateValue(categories, ['news', 'news'])).toEqual({ code: 'not-a-choice' });
    expect(validateValue(categories, 'news')).toEqual({ code: 'wrong-type' });
  });

  it('enforces minItems and maxItems', () => {
    expect(validateValue({ ...categories, minItems: 2 }, ['news'])).toEqual({
      code: 'too-few',
      limit: 2,
    });
    expect(validateValue({ ...categories, maxItems: 1 }, ['news', 'events'])).toEqual({
      code: 'too-many',
      limit: 1,
    });
  });

  it('writes the selection in declaration order', () => {
    const merged = mergeProperties({}, [categories], {
      'forum/categories': ['help desk', 'news'],
    });
    expect(merged.forum.categories).toEqual(['news', 'help desk']);
  });

  it('leaves the key alone when empty, or writes null when nullable', () => {
    expect(mergeProperties({ forum: { x: 1 } }, [categories], { 'forum/categories': [] })).toEqual(
      { forum: { x: 1 } },
    );
    const nullable = { ...categories, nullable: true };
    expect(mergeProperties({}, [nullable], { 'forum/categories': [] }).forum.categories).toBe(
      null,
    );
  });
});

describe('choicesAtIndices / indicesOfChoices', () => {
  it('round-trips values with spaces, in declaration order', () => {
    expect(choicesAtIndices(categories, ['2', '0'])).toEqual(['news', 'help desk']);
    expect(indicesOfChoices(categories, ['help desk', 'news'])).toEqual(['0', '2']);
  });

  it('drops indices and values that are not choices', () => {
    expect(choicesAtIndices(categories, ['9', 'x'])).toEqual([]);
    expect(indicesOfChoices(categories, ['nope'])).toEqual([]);
    expect(indicesOfChoices(categories, undefined)).toEqual([]);
  });
});
