import { describe, it, expect } from 'vitest';
import { declarationProblemMessage, valueProblemMessage } from './install-options-messages.js';

describe('valueProblemMessage', () => {
  it('names the limit for too many members', () => {
    expect(valueProblemMessage({ code: 'too-many', limit: 2 })).toContain('2');
  });

  it('counts members for an agent list and items for a choice list', () => {
    expect(valueProblemMessage({ code: 'too-few', limit: 2 }, 'agentList')).toContain('members');
    expect(valueProblemMessage({ code: 'too-few', limit: 2 }, 'stringChoiceList')).not.toContain(
      'members',
    );
    expect(valueProblemMessage({ code: 'too-many', limit: 3 }, 'stringChoiceList')).toContain('3');
  });

  it('has a message for every problem', () => {
    expect(valueProblemMessage({ code: 'required' })).not.toBe('');
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
