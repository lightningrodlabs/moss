import { msg, str } from '@lit/localize';
import type { ToolInstallOptionKind } from '@theweave/api';
import type { DeclarationProblem, ValueProblem } from './install-options.js';

/**
 * Localized text for the problems `install-options.ts` reports, kept apart
 * from the element so the wording is testable without a DOM.
 */

export function valueProblemMessage(
  problem: ValueProblem,
  kind: ToolInstallOptionKind = 'agentList',
): string {
  switch (problem.code) {
    case 'required':
      return msg('Required');
    case 'wrong-type':
      return msg('Wrong type');
    case 'not-a-choice':
      return msg('Choose one of the listed values');
    case 'too-short':
      return msg(str`At least ${problem.limit} characters`);
    case 'too-long':
      return msg(str`At most ${problem.limit} characters`);
    case 'below-min':
      return msg(str`At least ${problem.limit}`);
    case 'above-max':
      return msg(str`At most ${problem.limit}`);
    case 'not-integer':
      return msg('Must be a whole number');
    case 'too-few':
      return kind === 'agentList'
        ? msg(str`Select at least ${problem.limit} members`)
        : msg(str`Select at least ${problem.limit}`);
    case 'too-many':
      return kind === 'agentList'
        ? msg(str`Select at most ${problem.limit} members`)
        : msg(str`Select at most ${problem.limit}`);
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
    case 'bad-condition':
      return msg(str`Option ${name} depends on an option it cannot use`);
  }
}
