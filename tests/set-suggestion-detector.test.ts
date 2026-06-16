import { describe, it, expect } from 'vitest';
import { detectSuggestedSet } from '../src/main/set-suggestion-detector.js';
import type { SkippedScan } from '../src/main/set-suggestion-detector.js';

describe('detectSuggestedSet', () => {
  it('returns null for empty scans', () => {
    expect(detectSuggestedSet([], 3)).toBeNull();
  });

  it('returns null when no set meets the threshold', () => {
    const scans: SkippedScan[] = [
      { setCode: 'one', setName: 'ONE' },
      { setCode: 'mat', setName: 'MAT' },
    ];
    expect(detectSuggestedSet(scans, 3)).toBeNull();
  });

  it('returns the set that meets the threshold', () => {
    const scans: SkippedScan[] = [
      { setCode: 'one', setName: 'Phyrexia: All Will Be One' },
      { setCode: 'one', setName: 'Phyrexia: All Will Be One' },
      { setCode: 'one', setName: 'Phyrexia: All Will Be One' },
      { setCode: 'mat', setName: 'March of the Machine: The Aftermath' },
    ];
    const result = detectSuggestedSet(scans, 3);
    expect(result).not.toBeNull();
    expect(result?.setCode).toBe('one');
    expect(result?.count).toBe(3);
  });

  it('returns the set with the highest count when multiple meet threshold', () => {
    const scans: SkippedScan[] = [
      { setCode: 'one', setName: 'ONE' },
      { setCode: 'one', setName: 'ONE' },
      { setCode: 'one', setName: 'ONE' },
      { setCode: 'mat', setName: 'MAT' },
      { setCode: 'mat', setName: 'MAT' },
      { setCode: 'mat', setName: 'MAT' },
      { setCode: 'mat', setName: 'MAT' },
    ];
    const result = detectSuggestedSet(scans, 3);
    expect(result?.setCode).toBe('mat');
    expect(result?.count).toBe(4);
  });

  it('returns null with threshold of 0', () => {
    const scans: SkippedScan[] = [
      { setCode: 'one', setName: 'ONE' },
    ];
    expect(detectSuggestedSet(scans, 0)).toBeNull();
  });

  it('returns null with negative threshold', () => {
    const scans: SkippedScan[] = [
      { setCode: 'one', setName: 'ONE' },
    ];
    expect(detectSuggestedSet(scans, -1)).toBeNull();
  });

  it('exactly meets threshold of 5 (default config)', () => {
    const scans: SkippedScan[] = Array.from({ length: 5 }, () => ({
      setCode: 'woe',
      setName: 'Wilds of Eldraine',
    }));
    const result = detectSuggestedSet(scans, 5);
    expect(result?.setCode).toBe('woe');
    expect(result?.setName).toBe('Wilds of Eldraine');
    expect(result?.count).toBe(5);
  });

  it('returns null when one below threshold', () => {
    const scans: SkippedScan[] = Array.from({ length: 4 }, () => ({
      setCode: 'woe',
      setName: 'Wilds of Eldraine',
    }));
    expect(detectSuggestedSet(scans, 5)).toBeNull();
  });

  it('preserves the setName from the scans', () => {
    const scans: SkippedScan[] = [
      { setCode: 'dmu', setName: 'Dominaria United' },
      { setCode: 'dmu', setName: 'Dominaria United' },
      { setCode: 'dmu', setName: 'Dominaria United' },
    ];
    const result = detectSuggestedSet(scans, 3);
    expect(result?.setName).toBe('Dominaria United');
  });
});
