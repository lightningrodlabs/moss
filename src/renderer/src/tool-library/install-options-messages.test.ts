import { describe, it, expect } from 'vitest';
import type { ToolInstallOption } from '@theweave/api';
import { declarationProblemMessage, valueProblemMessage } from './install-options-messages.js';

const stewards: ToolInstallOption = {
  role: 'rVines',
  property: 'stewards',
  kind: 'agentList',
  label: 'Stewards',
  required: false,
  maxItems: 2,
};

describe('valueProblemMessage', () => {
  it('names the limit for too many members', () => {
    expect(valueProblemMessage('too-many', stewards)).toContain('2');
  });

  it('has a message for every problem', () => {
    expect(valueProblemMessage('required', stewards)).not.toBe('');
  });
});

describe('declarationProblemMessage', () => {
  it('names the missing role', () => {
    expect(declarationProblemMessage({ code: 'unknown-role', role: 'x', property: 'y' })).toContain(
      'x',
    );
  });

  it('names the option for a contradictory declaration', () => {
    expect(
      declarationProblemMessage({ code: 'required-nullable', role: 'x', property: 'y' }),
    ).toContain('x/y');
  });
});
