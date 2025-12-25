/**
 * TiaCC Test Runner - Node.js 测试框架集成
 *
 * 一个完整的测试运行器，支持：
 * - 覆盖率采集
 * - 并行测试执行
 * - 测试筛选 (基于 TIA 推荐)
 * - 详细报告
 *
 * Usage:
 *     npx tia-runner --tests ./tests --parallel 4
 *     npx tia-runner --affected --branch origin/main
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { Socket } from 'net';
import { glob } from 'glob';
import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TestConfig {
  // 连接配置
  host: string;
  port: number;
  timeout: number;

  // 录制模式
  mode: 'precise' | 'bucket';
  bucketSize: number;
  language: 'cpp' | 'csharp';

  // 测试执行
  testDir: string;
  testPattern: string;
  parallel: number;

  // 测试命令 (如何运行单个测试)
  testCommand: string;  // e.g., "lua" or "python" or "node"
  testArgs: string[];   // e.g., ["--config", "test.json"]

  // 可选：被测程序
  targetProcess?: string;
  targetArgs?: string[];
}

export interface TestResult {
  testId: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  duration: number;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface RunnerEvents {
  'test:start': (testId: string) => void;
  'test:end': (result: TestResult) => void;
  'suite:start': (total: number) => void;
  'suite:end': (results: TestResult[]) => void;
  'coverage:dump': (testId: string, path: string) => void;
}

// ============================================================================
// TiaCC Client (内置)
// ============================================================================

class TiaClient {
  private socket: Socket | null = null;
  private requestId = 0;
  private responseBuffer = '';
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private host: string,
    private port: number,
    private timeout: number
  ) {}

  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket = new Socket();
      this.socket.setTimeout(this.timeout);

      this.socket.on('data', (data) => this.handleData(data));
      this.socket.on('error', () => resolve(false));
      this.socket.on('timeout', () => {
        this.socket?.destroy();
        resolve(false);
      });

      this.socket.connect(this.port, this.host, () => resolve(true));
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  private handleData(data: Buffer): void {
    this.responseBuffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = this.responseBuffer.indexOf('\n')) !== -1) {
      const line = this.responseBuffer.slice(0, newlineIndex);
      this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

      try {
        const response = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  private sendRpc(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const request = { jsonrpc: '2.0', method, params: params ?? {}, id };

      this.pendingRequests.set(id, { resolve, reject });

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, this.timeout);

      this.socket.write(JSON.stringify(request) + '\n');
    });
  }

  startRecording(testId: string, language: string): Promise<boolean> {
    return this.sendRpc('startRecording', { testId, language })
      .then(r => r?.success ?? false)
      .catch(() => false);
  }

  stopRecording(testId: string): Promise<boolean> {
    return this.sendRpc('stopRecording', { testId })
      .then(r => r?.success ?? false)
      .catch(() => false);
  }

  dumpCoverage(testId: string, outputPath?: string): Promise<{ success: boolean; outputFile?: string }> {
    const params: Record<string, string> = { testId };
    if (outputPath) params.outputPath = outputPath;
    return this.sendRpc('dumpCoverage', params).catch(() => ({ success: false }));
  }

  resetAll(): Promise<boolean> {
    return this.sendRpc('resetAll')
      .then(r => r?.success ?? false)
      .catch(() => false);
  }
}

// ============================================================================
// Test Runner
// ============================================================================

export class TestRunner extends EventEmitter {
  private config: TestConfig;
  private client: TiaClient;
  private targetProcess: ChildProcess | null = null;
  private bucketCount = 0;
  private bucketId = 0;

  constructor(config: Partial<TestConfig> = {}) {
    super();
    this.config = {
      host: config.host ?? '127.0.0.1',
      port: config.port ?? 19840,
      timeout: config.timeout ?? 5000,
      mode: config.mode ?? 'precise',
      bucketSize: config.bucketSize ?? 50,
      language: config.language ?? 'cpp',
      testDir: config.testDir ?? './tests',
      testPattern: config.testPattern ?? '**/*.test.{js,ts,lua}',
      parallel: config.parallel ?? 1,
      testCommand: config.testCommand ?? 'node',
      testArgs: config.testArgs ?? [],
      targetProcess: config.targetProcess,
      targetArgs: config.targetArgs ?? [],
    };

    this.client = new TiaClient(
      this.config.host,
      this.config.port,
      this.config.timeout
    );
  }

  /**
   * 发现所有测试文件
   */
  async discoverTests(): Promise<string[]> {
    const pattern = `${this.config.testDir}/${this.config.testPattern}`;
    const files = await glob(pattern);
    return files.map(f => resolve(f));
  }

  /**
   * 启动被测目标进程
   */
  async startTarget(): Promise<boolean> {
    if (!this.config.targetProcess) return true;

    return new Promise((resolve) => {
      this.targetProcess = spawn(
        this.config.targetProcess!,
        this.config.targetArgs,
        { stdio: 'pipe' }
      );

      this.targetProcess.on('error', () => resolve(false));

      // 等待进程启动
      setTimeout(() => resolve(true), 1000);
    });
  }

  /**
   * 停止目标进程
   */
  stopTarget(): void {
    if (this.targetProcess) {
      this.targetProcess.kill();
      this.targetProcess = null;
    }
  }

  /**
   * 运行单个测试
   */
  async runTest(testPath: string): Promise<TestResult> {
    const testId = basename(testPath, '.test.js')
      .replace(/\.test\.(ts|lua|py)$/, '');

    const startTime = Date.now();
    this.emit('test:start', testId);

    try {
      // 开始覆盖率录制
      if (this.config.mode === 'precise') {
        await this.client.startRecording(testId, this.config.language);
      } else {
        this.bucketCount++;
        if (this.bucketCount === 1) {
          this.bucketId++;
          await this.client.startRecording(`bucket_${this.bucketId}`, this.config.language);
        }
      }

      // 执行测试
      const { exitCode, stdout, stderr } = await this.executeTest(testPath);

      // 停止覆盖率录制
      if (this.config.mode === 'precise') {
        await this.client.stopRecording(testId);
        const result = await this.client.dumpCoverage(testId);
        if (result.outputFile) {
          this.emit('coverage:dump', testId, result.outputFile);
        }
      } else if (this.bucketCount >= this.config.bucketSize) {
        await this.flushBucket();
      }

      const duration = Date.now() - startTime;
      const result: TestResult = {
        testId,
        status: exitCode === 0 ? 'passed' : 'failed',
        duration,
        stdout,
        stderr,
        error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
      };

      this.emit('test:end', result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const result: TestResult = {
        testId,
        status: 'error',
        duration,
        error: error instanceof Error ? error.message : String(error),
      };

      this.emit('test:end', result);
      return result;
    }
  }

  /**
   * 执行测试命令
   */
  private executeTest(testPath: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve) => {
      const args = [...this.config.testArgs, testPath];
      const proc = spawn(this.config.testCommand, args, { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data; });
      proc.stderr?.on('data', (data) => { stderr += data; });

      proc.on('close', (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });

      proc.on('error', (error) => {
        resolve({ exitCode: 1, stdout, stderr: error.message });
      });
    });
  }

  /**
   * 刷新当前桶
   */
  private async flushBucket(): Promise<void> {
    if (this.bucketCount > 0) {
      await this.client.stopRecording(`bucket_${this.bucketId}`);
      const result = await this.client.dumpCoverage(`bucket_${this.bucketId}`);
      if (result.outputFile) {
        this.emit('coverage:dump', `bucket_${this.bucketId}`, result.outputFile);
      }
      this.bucketCount = 0;
    }
  }

  /**
   * 运行所有测试
   */
  async runAll(testPaths?: string[]): Promise<TestResult[]> {
    const tests = testPaths ?? await this.discoverTests();

    if (tests.length === 0) {
      console.log('No tests found.');
      return [];
    }

    // 连接到覆盖率服务
    const connected = await this.client.connect();
    if (!connected) {
      console.warn('Warning: Could not connect to coverage service. Running without coverage.');
    }

    // 启动目标进程
    await this.startTarget();

    this.emit('suite:start', tests.length);
    const results: TestResult[] = [];

    if (this.config.parallel <= 1) {
      // 串行执行
      for (const test of tests) {
        const result = await this.runTest(test);
        results.push(result);
      }
    } else {
      // 并行执行
      const chunks = this.chunkArray(tests, this.config.parallel);
      for (const chunk of chunks) {
        const chunkResults = await Promise.all(chunk.map(t => this.runTest(t)));
        results.push(...chunkResults);
      }
    }

    // 刷新最后一个桶
    if (this.config.mode === 'bucket') {
      await this.flushBucket();
    }

    this.emit('suite:end', results);

    // 清理
    this.client.disconnect();
    this.stopTarget();

    return results;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// ============================================================================
// Reporter
// ============================================================================

export function printReport(results: TestResult[]): void {
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '='.repeat(60));
  console.log('Test Results');
  console.log('='.repeat(60));

  // 详细失败信息
  const failures = results.filter(r => r.status === 'failed' || r.status === 'error');
  if (failures.length > 0) {
    console.log('\nFailures:\n');
    for (const f of failures) {
      console.log(`  ✗ ${f.testId}`);
      if (f.error) console.log(`    Error: ${f.error}`);
      if (f.stderr) console.log(`    Stderr: ${f.stderr.slice(0, 200)}`);
    }
  }

  // 摘要
  console.log('\nSummary:');
  console.log(`  Total:    ${results.length}`);
  console.log(`  Passed:   ${passed} ✓`);
  console.log(`  Failed:   ${failed} ✗`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log();
}

// ============================================================================
// CLI
// ============================================================================

export async function main() {
  const args = process.argv.slice(2);

  const config: Partial<TestConfig> = {
    testDir: './tests',
    testPattern: '**/*.test.{js,ts,lua}',
    testCommand: 'node',
    parallel: 1,
    mode: 'precise',
  };

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--tests':
      case '-t':
        config.testDir = args[++i];
        break;
      case '--pattern':
      case '-p':
        config.testPattern = args[++i];
        break;
      case '--parallel':
      case '-j':
        config.parallel = parseInt(args[++i], 10);
        break;
      case '--command':
      case '-c':
        config.testCommand = args[++i];
        break;
      case '--mode':
      case '-m':
        config.mode = args[++i] as 'precise' | 'bucket';
        break;
      case '--bucket-size':
        config.bucketSize = parseInt(args[++i], 10);
        break;
      case '--port':
        config.port = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
TiaCC Test Runner

Usage: tia-runner [options]

Options:
  -t, --tests <dir>       Test directory (default: ./tests)
  -p, --pattern <glob>    Test file pattern (default: **/*.test.{js,ts,lua})
  -c, --command <cmd>     Test command (default: node)
  -j, --parallel <n>      Parallel test count (default: 1)
  -m, --mode <mode>       Recording mode: precise|bucket (default: precise)
  --bucket-size <n>       Bucket size (default: 50)
  --port <n>              Coverage service port (default: 19840)
  -h, --help              Show this help
`);
        process.exit(0);
    }
  }

  const runner = new TestRunner(config);

  // 事件监听
  runner.on('test:start', (testId) => {
    process.stdout.write(`  Running: ${testId}...`);
  });

  runner.on('test:end', (result: TestResult) => {
    const icon = result.status === 'passed' ? '✓' : '✗';
    console.log(` ${icon} (${result.duration}ms)`);
  });

  // 运行测试
  const results = await runner.runAll();
  printReport(results);

  // 退出码
  const hasFailures = results.some(r => r.status === 'failed' || r.status === 'error');
  process.exit(hasFailures ? 1 : 0);
}

// 直接运行时执行 main
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
