/**
 * Advanced Calculator 测试
 */

import { Calculator } from '../src/calculator.js';

describe('Calculator Advanced', () => {
  let calc;

  beforeEach(() => {
    calc = new Calculator();
  });

  describe('power', () => {
    test('calculates power', () => {
      expect(calc.power(2, 3)).toBe(8);
    });

    test('handles zero exponent', () => {
      expect(calc.power(5, 0)).toBe(1);
    });

    test('handles negative exponent', () => {
      expect(calc.power(2, -1)).toBe(0.5);
    });
  });

  describe('sqrt', () => {
    test('calculates square root', () => {
      expect(calc.sqrt(16)).toBe(4);
    });

    test('handles zero', () => {
      expect(calc.sqrt(0)).toBe(0);
    });

    test('throws for negative', () => {
      expect(() => calc.sqrt(-1)).toThrow('Cannot compute square root');
    });
  });

  describe('getLastResult', () => {
    test('returns last result', () => {
      calc.add(1, 2);
      calc.multiply(3, 4);
      expect(calc.getLastResult()).toBe(12);
    });

    test('returns null when empty', () => {
      expect(calc.getLastResult()).toBeNull();
    });
  });
});
