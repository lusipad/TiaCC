/**
 * TiaCC TypeScript/JavaScript Client - 测试框架集成钩子
 *
 * Usage:
 *     import { TiaHooks } from './tia_hooks';
 *
 *     const hooks = new TiaHooks();
 *     await hooks.connect();
 *
 *     for (const test of tests) {
 *         await hooks.beforeTest(test.name);
 *         await runTest(test);
 *         await hooks.afterTest(test.name);
 *     }
 *
 *     hooks.disconnect();
 */

import { Socket } from 'net';

export interface TiaConfig {
  host?: string;
  port?: number;
  timeout?: number;
  mode?: 'precise' | 'bucket';
  bucketSize?: number;
  language?: 'cpp' | 'csharp';
}

export class TiaHooks {
  private config: Required<TiaConfig>;
  private socket: Socket | null = null;
  private requestId = 0;
  private bucketCount = 0;
  private bucketTests: string[] = [];
  private responseBuffer = '';

  constructor(config: TiaConfig = {}) {
    this.config = {
      host: config.host ?? '127.0.0.1',
      port: config.port ?? 19840,
      timeout: config.timeout ?? 5000,
      mode: config.mode ?? 'precise',
      bucketSize: config.bucketSize ?? 50,
      language: config.language ?? 'cpp',
    };
  }

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.socket = new Socket();
      this.socket.setTimeout(this.config.timeout);

      this.socket.on('error', (err) => {
        console.error(`[TiaCC] 连接错误: ${err.message}`);
        resolve(false);
      });

      this.socket.connect(this.config.port, this.config.host, () => {
        resolve(true);
      });
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  private sendRpc(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected'));
        return;
      }

      const request = {
        jsonrpc: '2.0',
        method,
        params: params ?? {},
        id: ++this.requestId,
      };

      const onData = (data: Buffer) => {
        this.responseBuffer += data.toString();
        const newlineIndex = this.responseBuffer.indexOf('\n');

        if (newlineIndex !== -1) {
          const line = this.responseBuffer.slice(0, newlineIndex);
          this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

          this.socket?.off('data', onData);

          try {
            const response = JSON.parse(line);
            resolve(response.result);
          } catch (e) {
            reject(e);
          }
        }
      };

      this.socket.on('data', onData);
      this.socket.write(JSON.stringify(request) + '\n');
    });
  }

  async startRecording(testId: string): Promise<boolean> {
    const result = await this.sendRpc('startRecording', {
      testId,
      language: this.config.language,
    });
    return result?.success ?? false;
  }

  async stopRecording(testId: string): Promise<boolean> {
    const result = await this.sendRpc('stopRecording', { testId });
    return result?.success ?? false;
  }

  async dumpCoverage(testId: string, outputPath?: string): Promise<boolean> {
    const params: Record<string, string> = { testId };
    if (outputPath) params.outputPath = outputPath;

    const result = await this.sendRpc('dumpCoverage', params);
    return result?.success ?? false;
  }

  async resetAll(): Promise<boolean> {
    const result = await this.sendRpc('resetAll');
    return result?.success ?? false;
  }

  async getStatus(): Promise<{ recording: boolean; testId: string; runtimeAvailable: boolean } | null> {
    return this.sendRpc('getStatus');
  }

  // 高级 API
  async beforeTest(testId: string): Promise<void> {
    if (this.config.mode === 'precise') {
      await this.startRecording(testId);
    } else {
      this.bucketTests.push(testId);
      this.bucketCount++;
      if (this.bucketCount === 1) {
        await this.startRecording(`bucket_${Math.floor(this.requestId / this.config.bucketSize)}`);
      }
    }
  }

  async afterTest(testId: string): Promise<void> {
    if (this.config.mode === 'precise') {
      await this.stopRecording(testId);
      await this.dumpCoverage(testId);
    } else if (this.bucketCount >= this.config.bucketSize) {
      await this.flushBucket();
    }
  }

  async flushBucket(): Promise<void> {
    if (this.bucketCount > 0) {
      const bucketId = `bucket_${Math.floor(this.requestId / this.config.bucketSize)}`;
      await this.stopRecording(bucketId);
      await this.dumpCoverage(bucketId);
      this.bucketTests = [];
      this.bucketCount = 0;
    }
  }
}

// 使用示例
async function main() {
  const hooks = new TiaHooks({ mode: 'precise' });

  if (await hooks.connect()) {
    console.log('状态:', await hooks.getStatus());

    await hooks.beforeTest('test_example');
    // ... 运行测试 ...
    await hooks.afterTest('test_example');

    hooks.disconnect();
  }
}
