/**
 * Calculator 测试
 */

import { Calculator } from '../src/calculator.js';

describe('Calculator', () => {
  let calc;

  beforeEach(() => {
    calc = new Calculator();
  });

  describe('add', () => {
    test('adds two positive numbers', () => {
      expect(calc.add(2, 3)).toBe(5);
    });

    test('adds negative numbers', () => {
      expect(calc.add(-1, -2)).toBe(-3);
    });

    test('adds zero', () => {
      expect(calc.add(5, 0)).toBe(5);
    });
  });

  describe('subtract', () => {
    test('subtracts two numbers', () => {
      expect(calc.subtract(5, 3)).toBe(2);
    });

    test('handles negative result', () => {
      expect(calc.subtract(3, 5)).toBe(-2);
    });
  });

  describe('multiply', () => {
    test('multiplies two numbers', () => {
      expect(calc.multiply(3, 4)).toBe(12);
    });

    test('multiplies by zero', () => {
      expect(calc.multiply(5, 0)).toBe(0);
    });
  });

  describe('divide', () => {
    test('divides two numbers', () => {
      expect(calc.divide(10, 2)).toBe(5);
    });

    test('throws on division by zero', () => {
      expect(() => calc.divide(5, 0)).toThrow('Division by zero');
    });
  });

  describe('history', () => {
    test('records operations', () => {
      calc.add(1, 2);
      calc.multiply(3, 4);
      expect(calc.getHistory()).toHaveLength(2);
    });

    test('clears history', () => {
      calc.add(1, 2);
      calc.clearHistory();
      expect(calc.getHistory()).toHaveLength(0);
    });
  });
});
