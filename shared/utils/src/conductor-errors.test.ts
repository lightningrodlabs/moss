import { describe, expect, it } from 'vitest';
import { isCellNotRunningError } from './utils';

describe('isCellNotRunningError', () => {
  it('recognises the 0.7.1 CellNotRunning error', () => {
    const error = new Error(
      'Conductor returned an error while using a ConductorApi: CellNotRunning(CellId(..), AppDisabled)',
    );
    expect(isCellNotRunningError(error)).toBe(true);
  });

  it('recognises the 0.7.0 CellDisabled error', () => {
    expect(isCellNotRunningError('ConductorError::CellDisabled(CellId(..))')).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    expect(isCellNotRunningError(new Error('ZomeCallUnauthorized'))).toBe(false);
    expect(isCellNotRunningError(undefined)).toBe(false);
    expect(isCellNotRunningError({})).toBe(false);
  });
});
