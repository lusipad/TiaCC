/**
 * Formatter - 数字格式化模块
 */

export class Formatter {
  // 格式化为货币
  static currency(value, currency = 'USD', locale = 'en-US') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(value);
  }

  // 格式化为百分比
  static percentage(value, decimals = 2) {
    return (value * 100).toFixed(decimals) + '%';
  }

  // 格式化为科学计数法
  static scientific(value, decimals = 2) {
    return value.toExponential(decimals);
  }

  // 格式化为带千分位的数字
  static thousands(value, locale = 'en-US') {
    return new Intl.NumberFormat(locale).format(value);
  }

  // 四舍五入到指定小数位
  static round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  // 格式化文件大小
  static fileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

export default Formatter;
