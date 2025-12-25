/**
 * Statistics 测试
 */

import { Statistics } from '../src/statistics.js';

describe('Statistics', () => {
  describe('mean', () => {
    test('calculates mean of numbers', () => {
      expect(Statistics.mean([1, 2, 3, 4, 5])).toBe(3);
    });

    test('returns 0 for empty array', () => {
      expect(Statistics.mean([])).toBe(0);
    });

    test('handles single value', () => {
      expect(Statistics.mean([5])).toBe(5);
    });
  });

  describe('median', () => {
    test('calculates median of odd count', () => {
      expect(Statistics.median([1, 2, 3, 4, 5])).toBe(3);
    });

    test('calculates median of even count', () => {
      expect(Statistics.median([1, 2, 3, 4])).toBe(2.5);
    });

    test('handles unsorted array', () => {
      expect(Statistics.median([5, 1, 3, 2, 4])).toBe(3);
    });
  });

  describe('mode', () => {
    test('finds most frequent value', () => {
      expect(Statistics.mode([1, 2, 2, 3, 3, 3])).toBe(3);
    });

    test('returns null for empty array', () => {
      expect(Statistics.mode([])).toBeNull();
    });
  });

  describe('standardDeviation', () => {
    test('calculates standard deviation', () => {
      const result = Statistics.standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2, 0);
    });
  });

  describe('range', () => {
    test('calculates range', () => {
      expect(Statistics.range([1, 5, 3, 9, 2])).toBe(8);
    });
  });
});
