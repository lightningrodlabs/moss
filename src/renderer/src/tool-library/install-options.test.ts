import { describe, it, expect } from 'vitest';
import type { ToolInstallOption } from '@theweave/api';
import type { RoleProperties } from '@theweave/moss-types';
import {
  checkDeclarations,
  choiceFromString,
  initialValues,
  mergeProperties,
  optionKey,
  validateValue,
} from './install-options.js';

const stewarded: ToolInstallOption = {
  role: 'rVines',
  property: 'stewarded',
  kind: 'boolean',
  label: 'Stewarded',
  required: false,
  default: false,
};
const stewards: ToolInstallOption = {
  role: 'rVines',
  property: 'stewards',
  kind: 'agentList',
  label: 'Stewards',
  required: false,
  maxItems: 50,
};
const maxPosts: ToolInstallOption = {
  role: 'forum',
  property: 'maxPosts',
  kind: 'number',
  label: 'Max posts',
  required: true,
  min: 1,
  max: 1000,
  integer: true,
};
const motto: ToolInstallOption = {
  role: 'forum',
  property: 'motto',
  kind: 'string',
  label: 'Motto',
  required: false,
  maxLength: 2,
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
  ],
};
const pageSize: ToolInstallOption = {
  role: 'forum',
  property: 'pageSize',
  kind: 'numberChoice',
  label: 'Page size',
  required: false,
  choices: [
    { value: 10, label: '10' },
    { value: 25, label: '25' },
  ],
};
const postLimit: ToolInstallOption = {
  role: 'forum',
  property: 'postLimit',
  kind: 'number',
  label: 'Post limit',
  required: false,
  min: 1,
  max: 1000,
  integer: true,
  nullable: true,
};

describe('optionKey', () => {
  it('joins role and property', () => {
    expect(optionKey(stewarded)).toBe('rVines/stewarded');
  });
});

describe('checkDeclarations', () => {
  const roles = ['rVines', 'forum'];

  it('accepts the Vines pair', () => {
    expect(checkDeclarations([stewarded, stewards], roles)).toBeUndefined();
  });

  it('reports a role missing from the happ', () => {
    expect(checkDeclarations([stewarded], ['forum'])).toEqual({
      code: 'unknown-role',
      role: 'rVines',
      property: 'stewarded',
    });
  });

  it('reports a duplicate role/property', () => {
    expect(checkDeclarations([stewarded, { ...stewarded, label: 'Again' }], roles)).toEqual({
      code: 'duplicate',
      role: 'rVines',
      property: 'stewarded',
    });
  });

  it('reports min above max', () => {
    expect(checkDeclarations([{ ...maxPosts, min: 5, max: 3 }], roles)?.code).toBe('bad-range');
  });

  it('reports minLength above maxLength', () => {
    expect(checkDeclarations([{ ...motto, minLength: 4, maxLength: 2 }], roles)?.code).toBe(
      'bad-length',
    );
  });

  it('reports minItems above maxItems', () => {
    expect(checkDeclarations([{ ...stewards, minItems: 3, maxItems: 1 }], roles)?.code).toBe(
      'bad-items',
    );
  });

  it('reports empty choices', () => {
    expect(checkDeclarations([{ ...theme, choices: [] }], roles)?.code).toBe('bad-choices');
  });

  it('reports repeated choice values', () => {
    const choices = [
      { value: 'light', label: 'A' },
      { value: 'light', label: 'B' },
    ];
    expect(checkDeclarations([{ ...theme, choices }], roles)?.code).toBe('bad-choices');
  });

  it('reports a default outside its constraints', () => {
    expect(checkDeclarations([{ ...maxPosts, max: 3, default: 5 }], roles)?.code).toBe(
      'bad-default',
    );
  });

  it('reports a null default without nullable', () => {
    expect(checkDeclarations([{ ...motto, default: null }], roles)?.code).toBe('bad-default');
  });

  it('reports required together with nullable', () => {
    expect(checkDeclarations([{ ...postLimit, required: true }], roles)?.code).toBe(
      'required-nullable',
    );
  });
});

describe('initialValues', () => {
  const manifest: RoleProperties = {
    rVines: { stewarded: false, stewards: [] },
    forum: { maxPosts: 7, motto: 'yes', postLimit: null },
  };

  it('prefers the declaration default over the manifest', () => {
    const values = initialValues([{ ...stewarded, default: true }], manifest);
    expect(values['rVines/stewarded']).toBe(true);
  });

  it('falls back to the manifest default', () => {
    expect(initialValues([maxPosts], manifest)['forum/maxPosts']).toBe(7);
  });

  it('ignores a manifest default of the wrong type', () => {
    const values = initialValues([{ ...stewarded, default: undefined }], {
      rVines: { stewarded: 'yes' },
    });
    expect(values['rVines/stewarded']).toBe(false);
  });

  it('starts a boolean at false when nothing is declared', () => {
    const values = initialValues([{ ...stewarded, default: undefined }], {});
    expect(values['rVines/stewarded']).toBe(false);
  });

  it('starts a nullable option at null when nothing is declared', () => {
    expect(initialValues([postLimit], {})['forum/postLimit']).toBeNull();
  });

  it('keeps a manifest null for a nullable option', () => {
    expect(initialValues([postLimit], manifest)['forum/postLimit']).toBeNull();
  });

  it('starts an agent list empty', () => {
    expect(initialValues([stewards], manifest)['rVines/stewards']).toEqual([]);
  });

  it('leaves a non-nullable option without any default unset', () => {
    expect(initialValues([maxPosts], {})['forum/maxPosts']).toBeUndefined();
  });
});

describe('validateValue', () => {
  it('requires a value for a required option', () => {
    expect(validateValue(maxPosts, undefined)).toBe('required');
  });

  it('accepts an empty optional option', () => {
    expect(validateValue(motto, undefined)).toBeUndefined();
  });

  it('rejects a fraction for an integer option', () => {
    expect(validateValue(maxPosts, 2.5)).toBe('not-integer');
  });

  it('rejects a number above max', () => {
    expect(validateValue(maxPosts, 1001)).toBe('above-max');
  });

  it('rejects a number below min', () => {
    expect(validateValue(maxPosts, 0)).toBe('below-min');
  });

  it('rejects a string longer than maxLength', () => {
    expect(validateValue(motto, 'abc')).toBe('too-long');
  });

  it('rejects a string shorter than minLength', () => {
    expect(validateValue({ ...motto, minLength: 2, maxLength: 5 }, 'a')).toBe('too-short');
  });

  it('rejects a number choice outside the choices', () => {
    expect(validateValue(pageSize, 11)).toBe('not-a-choice');
  });

  it('rejects a string choice outside the choices', () => {
    expect(validateValue(theme, 'sepia')).toBe('not-a-choice');
  });

  it('rejects too many agents', () => {
    expect(validateValue({ ...stewards, maxItems: 1 }, ['uhCAk1', 'uhCAk2'])).toBe('too-many');
  });

  it('rejects too few agents', () => {
    expect(validateValue({ ...stewards, minItems: 2 }, ['uhCAk1'])).toBe('too-few');
  });

  it('treats an empty optional agent list as unset', () => {
    expect(validateValue(stewards, [])).toBeUndefined();
  });

  it('rejects a string for a boolean', () => {
    expect(validateValue(stewarded, 'true')).toBe('wrong-type');
  });

  it('accepts null for a nullable option', () => {
    expect(validateValue(postLimit, null)).toBeUndefined();
  });

  it('rejects null for a non-nullable option', () => {
    expect(validateValue({ ...maxPosts, required: false }, null)).toBe('wrong-type');
  });
});

describe('mergeProperties', () => {
  const base: RoleProperties = {
    rVines: { groupName: 'MyTeam', stewarded: false, stewards: [] },
  };

  it('overlays chosen values and keeps the rest', () => {
    const merged = mergeProperties(base, [stewarded, stewards], { 'rVines/stewarded': true });
    expect(merged.rVines).toEqual({ groupName: 'MyTeam', stewarded: true, stewards: [] });
  });

  it('creates a role absent from the base', () => {
    const merged = mergeProperties(base, [maxPosts], { 'forum/maxPosts': 3 });
    expect(merged.forum).toEqual({ maxPosts: 3 });
  });

  it('leaves an unset optional key as in the base', () => {
    const merged = mergeProperties(base, [stewards], { 'rVines/stewards': undefined });
    expect(merged.rVines.stewards).toEqual([]);
  });

  it('writes null for an unset nullable option', () => {
    const merged = mergeProperties({ forum: { postLimit: 5 } }, [postLimit], {});
    expect(merged.forum.postLimit).toBeNull();
  });

  it('does not mutate the base', () => {
    mergeProperties(base, [stewarded], { 'rVines/stewarded': true });
    expect(base.rVines.stewarded).toBe(false);
  });
});

describe('choiceFromString', () => {
  it('maps a number choice back to its numeric value', () => {
    expect(choiceFromString(pageSize, '25')).toBe(25);
  });

  it('keeps a string choice as a string', () => {
    expect(choiceFromString(theme, 'dark')).toBe('dark');
  });

  it('treats an empty selection as unset', () => {
    expect(choiceFromString(pageSize, '')).toBeUndefined();
  });
});
