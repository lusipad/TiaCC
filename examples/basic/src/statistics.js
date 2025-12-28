/**
 * Statistics - 统计计算模块
 */

export class Statistics {
  // 平均值
  static mean(numbers) {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return sum / numbers.length;
  }

  // 中位数
  static median(numbers) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  // 众数
  static mode(numbers) {
    if (numbers.length === 0) return null;

    const frequency = {};
    let maxFreq = 0;
    let mode = numbers[0];

    for (const num of numbers) {
      frequency[num] = (frequency[num] || 0) + 1;
      if (frequency[num] > maxFreq) {
        maxFreq = frequency[num];
        mode = num;
      }
    }

    return mode;
  }

  // 标准差
  static standardDeviation(numbers) {
    if (numbers.length === 0) return 0;

    const avg = this.mean(numbers);
    const squareDiffs = numbers.map(n => Math.pow(n - avg, 2));
    const avgSquareDiff = this.mean(squareDiffs);

    return Math.sqrt(avgSquareDiff);
  }

  // 范围
  static range(numbers) {
    if (numbers.length === 0) return 0;
    return Math.max(...numbers) - Math.min(...numbers);
  }
}

export default Statistics;
