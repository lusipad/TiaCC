/**
 * Formatter 测试
 */

import { Formatter } from '../src/formatter.js';

describe('Formatter', () => {
  describe('percentage', () => {
    test('formats as percentage', () => {
      expect(Formatter.percentage(0.1234)).toBe('12.34%');
    });

    test('custom decimals', () => {
      expect(Formatter.percentage(0.5, 0)).toBe('50%');
    });
  });

  describe('scientific', () => {
    test('formats in scientific notation', () => {
      expect(Formatter.scientific(12345, 2)).toBe('1.23e+4');
    });
  });

  describe('round', () => {
    test('rounds to decimals', () => {
      expect(Formatter.round(3.14159, 2)).toBe(3.14);
    });

    test('rounds to integer', () => {
      expect(Formatter.round(3.7, 0)).toBe(4);
    });
  });

  describe('fileSize', () => {
    test('formats bytes', () => {
      expect(Formatter.fileSize(500)).toBe('500.00 B');
    });

    test('formats kilobytes', () => {
      expect(Formatter.fileSize(1536)).toBe('1.50 KB');
    });

    test('formats megabytes', () => {
      expect(Formatter.fileSize(1572864)).toBe('1.50 MB');
    });

    test('formats gigabytes', () => {
      expect(Formatter.fileSize(1610612736)).toBe('1.50 GB');
    });
  });

  describe('thousands', () => {
    test('formats with thousands separator', () => {
      expect(Formatter.thousands(1234567)).toBe('1,234,567');
    });
  });
});
