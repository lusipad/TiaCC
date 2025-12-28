/**
 * Calculator - 被测试的代码
 *
 * 这是一个简单的计算器模块，用于演示 TiaCC 的工作原理。
 */

export class Calculator {
  constructor() {
    this.history = [];
  }

  // 基础运算
  add(a, b) {
    const result = a + b;
    this.history.push({ op: 'add', a, b, result });
    return result;
  }

  subtract(a, b) {
    const result = a - b;
    this.history.push({ op: 'subtract', a, b, result });
    return result;
  }

  multiply(a, b) {
    const result = a * b;
    this.history.push({ op: 'multiply', a, b, result });
    return result;
  }

  divide(a, b) {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    const result = a / b;
    this.history.push({ op: 'divide', a, b, result });
    return result;
  }

  // 高级运算
  power(base, exponent) {
    const result = Math.pow(base, exponent);
    this.history.push({ op: 'power', base, exponent, result });
    return result;
  }

  sqrt(n) {
    if (n < 0) {
      throw new Error('Cannot compute square root of negative number');
    }
    const result = Math.sqrt(n);
    this.history.push({ op: 'sqrt', n, result });
    return result;
  }

  // 历史记录
  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }

  getLastResult() {
    if (this.history.length === 0) {
      return null;
    }
    return this.history[this.history.length - 1].result;
  }
}

export default Calculator;
