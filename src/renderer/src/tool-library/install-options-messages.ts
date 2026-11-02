import { msg, str } from '@lit/localize';
import type { ToolInstallOption } from '@theweave/api';
import type { DeclarationProblem, ValueProblem } from './install-options.js';

/**
 * Localized text for the problems `install-options.ts` reports, kept apart
 * from the element so the wording is testable without a DOM.
 */

export function valueProblemMessage(problem: ValueProblem, option: ToolInstallOption): string {
  switch (problem) {
    case 'required':
      return msg('Required');
    case 'wrong-type':
      return msg('Wrong type');
    case 'not-a-choice':
      return msg('Choose one of the listed values');
    case 'too-short':
      return msg(str`At least ${option.kind === 'string' ? (option.minLength ?? 0) : 0} characters`);
    case 'too-long':
      return msg(str`At most ${option.kind === 'string' ? option.maxLength : 0} characters`);
    case 'below-min':
      return msg(str`At least ${option.kind === 'number' ? option.min : 0}`);
    case 'above-max':
      return msg(str`At most ${option.kind === 'number' ? option.max : 0}`);
    case 'not-integer':
      return msg('Must be a whole number');
    case 'too-few':
      return msg(
        str`Select at least ${option.kind === 'agentList' ? (option.minItems ?? 0) : 0} members`,
      );
    case 'too-many':
      return msg(
        str`Select at most ${option.kind === 'agentList' ? (option.maxItems ?? 0) : 0} members`,
      );
  }
}

export function declarationProblemMessage(problem: DeclarationProblem): string {
  const { role, property } = problem;
  const name = `${role}/${property}`;
  switch (problem.code) {
    case 'unknown-role':
      return msg(str`Role "${role}" is not in this Tool's happ`);
    case 'duplicate':
      return msg(str`Option ${name} is declared twice`);
    case 'bad-range':
    case 'bad-length':
    case 'bad-items':
      return msg(str`Option ${name} has an invalid range`);
    case 'bad-choices':
      return msg(str`Option ${name} has invalid choices`);
    case 'bad-default':
      return msg(str`Option ${name} has a default outside its constraints`);
    case 'required-nullable':
      return msg(str`Option ${name} cannot be both required and nullable`);
  }
}
