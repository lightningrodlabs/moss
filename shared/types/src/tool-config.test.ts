import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TToolWeaveConfig } from './tool-config.js';

const vinesExample = {
  crossGroupView: true,
  installOptions: [
    {
      role: 'rVines',
      property: 'stewarded',
      kind: 'boolean',
      label: 'Stewarded',
      description: 'Only stewards create categories and channels.',
      required: false,
      default: false,
    },
    {
      role: 'rVines',
      property: 'stewards',
      kind: 'agentList',
      label: 'Stewards',
      description: 'Members who may shape the structure. You always count.',
      required: false,
      maxItems: 50,
    },
  ],
};

const numberOption = {
  role: 'forum',
  property: 'maxPosts',
  kind: 'number',
  label: 'Max posts',
  required: true,
  min: 1,
  max: 1000,
  integer: true,
};

describe('TToolWeaveConfig', () => {
  it('accepts labels and descriptions keyed by language', () => {
    const localized = {
      installOptions: [
        {
          ...vinesExample.installOptions[0],
          label: { en: 'Stewarded', de: 'Verwaltet' },
          description: { en: 'Only stewards create categories.' },
        },
        {
          role: 'rVines',
          property: 'theme',
          kind: 'stringChoice',
          label: 'Theme',
          required: false,
          choices: [{ value: 'dark', label: { en: 'Dark', de: 'Dunkel' } }],
        },
      ],
    };
    expect(Value.Check(TToolWeaveConfig, localized)).toBe(true);
  });

  it('rejects a label map whose values are not strings', () => {
    const bad = {
      installOptions: [{ ...vinesExample.installOptions[0], label: { en: 1 } }],
    };
    expect(Value.Check(TToolWeaveConfig, bad)).toBe(false);
  });

  it('accepts the Vines example', () => {
    expect(Value.Check(TToolWeaveConfig, vinesExample)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const config = { installOptions: [{ ...numberOption, kind: 'colour' }] };
    expect(Value.Check(TToolWeaveConfig, config)).toBe(false);
  });

  it('rejects a number option without max', () => {
    const { max: _max, ...withoutMax } = numberOption;
    expect(Value.Check(TToolWeaveConfig, { installOptions: [withoutMax] })).toBe(false);
  });

  it('rejects nullable on a boolean option', () => {
    const option = { ...vinesExample.installOptions[0], nullable: true };
    expect(Value.Check(TToolWeaveConfig, { installOptions: [option] })).toBe(false);
  });

  it('accepts a nullable number option with a null default', () => {
    const option = { ...numberOption, required: false, nullable: true, default: null };
    expect(Value.Check(TToolWeaveConfig, { installOptions: [option] })).toBe(true);
  });

  it('accepts a config with only crossGroupView', () => {
    expect(Value.Check(TToolWeaveConfig, { crossGroupView: true })).toBe(true);
  });
});
