#!/usr/bin/env node
/**
 * TiaCC 完整演示
 *
 * 这个脚本演示 TiaCC 的完整工作流程：
 * 1. 运行所有测试并收集覆盖率
 * 2. 构建源文件→测试的映射数据库
 * 3. 模拟代码修改，推荐受影响的测试
 *
 * 使用方法:
 *   node demo.js          # 交互式演示
 *   node demo.js --full   # 运行全量测试
 *   node demo.js --affected calculator.js  # 查看修改文件影响的测试
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 配置
// ============================================================================

const CONFIG = {
  dbPath: join(__dirname, 'impact_map.db'),
  coverageDir: join(__dirname, 'coverage'),
  testsDir: join(__dirname, 'tests'),
  srcDir: join(__dirname, 'src'),
};

// ============================================================================
// 工具函数
// ============================================================================

function log(msg, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // cyan
    success: '\x1b[32m', // green
    warn: '\x1b[33m',    // yellow
    error: '\x1b[31m',   // red
    bold: '\x1b[1m',
    reset: '\x1b[0m',
  };

  const icons = {
    info: 'ℹ',
    success: '✓',
    warn: '⚠',
    error: '✗',
  };

  console.log(`${colors[type]}${icons[type] || ''}${colors.reset} ${msg}`);
}

function header(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 步骤 1: 运行测试并收集覆盖率
// ============================================================================

async function runTestsWithCoverage() {
  header('步骤 1: 运行测试并收集覆盖率');

  log('正在运行 Jest 测试...');

  try {
    // 运行 Jest with coverage
    execSync('npm test -- --coverage --coverageReporters=json --silent', {
      cwd: __dirname,
      stdio: 'pipe',
    });
    log('所有测试通过!', 'success');
  } catch (error) {
    // Jest 返回非零退出码如果有测试失败，但我们仍然可以获取覆盖率
    log('测试完成 (可能有失败)', 'warn');
  }

  // 检查覆盖率输出
  const coveragePath = join(__dirname, 'coverage', 'coverage-final.json');
  if (existsSync(coveragePath)) {
    log(`覆盖率数据已生成: ${coveragePath}`, 'success');
    return JSON.parse(readFileSync(coveragePath, 'utf-8'));
  } else {
    log('未找到覆盖率数据', 'error');
    return null;
  }
}

// ============================================================================
// 步骤 2: 构建映射数据库
// ============================================================================

function buildMappingDatabase(coverageData) {
  header('步骤 2: 构建映射数据库');

  // 初始化数据库
  const db = new Database(CONFIG.dbPath);
  db.exec(`
    DROP TABLE IF EXISTS coverage_map;
    DROP TABLE IF EXISTS source_files;
    DROP TABLE IF EXISTS test_files;

    CREATE TABLE source_files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE
    );

    CREATE TABLE test_files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE
    );

    CREATE TABLE coverage_map (
      source_id INTEGER,
      test_id INTEGER,
      covered_lines INTEGER,
      total_lines INTEGER,
      PRIMARY KEY (source_id, test_id)
    );
  `);

  log('数据库已初始化');

  // 从覆盖率数据解析映射关系
  // Jest 的 coverage-final.json 格式: { "文件路径": { statementMap, s, ... } }
  const sourceInsert = db.prepare('INSERT OR IGNORE INTO source_files (path) VALUES (?)');
  const testInsert = db.prepare('INSERT OR IGNORE INTO test_files (path) VALUES (?)');
  const mapInsert = db.prepare(`
    INSERT OR REPLACE INTO coverage_map (source_id, test_id, covered_lines, total_lines)
    VALUES (
      (SELECT id FROM source_files WHERE path = ?),
      (SELECT id FROM test_files WHERE path = ?),
      ?, ?
    )
  `);

  // 映射规则：基于文件名匹配
  // calculator.js → calculator.test.js, advanced.test.js
  // statistics.js → statistics.test.js
  // formatter.js → formatter.test.js

  const mappingRules = {
    'calculator.js': ['calculator.test.js', 'advanced.test.js'],
    'statistics.js': ['statistics.test.js'],
    'formatter.js': ['formatter.test.js'],
  };

  let sourceCount = 0;
  let testCount = 0;
  let mapCount = 0;

  for (const [filePath, coverage] of Object.entries(coverageData)) {
    const fileName = basename(filePath);

    // 只处理 src 目录下的文件
    if (!filePath.includes('/src/')) continue;

    sourceInsert.run(fileName);
    sourceCount++;

    // 计算覆盖行数
    const statements = coverage.s || {};
    const totalLines = Object.keys(statements).length;
    const coveredLines = Object.values(statements).filter(v => v > 0).length;

    // 根据映射规则添加关系
    const relatedTests = mappingRules[fileName] || [];
    for (const testFile of relatedTests) {
      testInsert.run(testFile);
      mapInsert.run(fileName, testFile, coveredLines, totalLines);
      mapCount++;
    }
  }

  // 确保所有测试文件都被记录
  const testFiles = readdirSync(CONFIG.testsDir).filter(f => f.endsWith('.test.js'));
  for (const testFile of testFiles) {
    testInsert.run(testFile);
    testCount++;
  }

  db.close();

  log(`源文件: ${sourceCount}`, 'success');
  log(`测试文件: ${testCount}`, 'success');
  log(`映射关系: ${mapCount}`, 'success');
  log(`数据库保存到: ${CONFIG.dbPath}`, 'success');
}

// ============================================================================
// 步骤 3: 查询受影响的测试
// ============================================================================

function getAffectedTests(changedFiles) {
  header('步骤 3: 查询受影响的测试');

  const db = new Database(CONFIG.dbPath);

  log(`变更的文件: ${changedFiles.join(', ')}`);

  const query = db.prepare(`
    SELECT DISTINCT t.path as test_path, s.path as source_path,
           m.covered_lines, m.total_lines
    FROM coverage_map m
    JOIN source_files s ON m.source_id = s.id
    JOIN test_files t ON m.test_id = t.id
    WHERE s.path IN (${changedFiles.map(() => '?').join(',')})
  `);

  const results = query.all(...changedFiles);
  db.close();

  if (results.length === 0) {
    log('没有找到受影响的测试', 'warn');
    return [];
  }

  console.log('\n受影响的测试:');
  console.log('─'.repeat(50));

  const tests = new Set();
  for (const row of results) {
    tests.add(row.test_path);
    const coverage = ((row.covered_lines / row.total_lines) * 100).toFixed(1);
    console.log(`  ${row.test_path}`);
    console.log(`    ← ${row.source_path} (覆盖率: ${coverage}%)`);
  }

  console.log('─'.repeat(50));
  log(`共 ${tests.size} 个测试需要运行`, 'success');

  return Array.from(tests);
}

// ============================================================================
// 步骤 4: 只运行受影响的测试
// ============================================================================

async function runAffectedTests(testFiles) {
  header('步骤 4: 运行受影响的测试');

  if (testFiles.length === 0) {
    log('没有需要运行的测试', 'info');
    return;
  }

  const testPatterns = testFiles.map(f => `tests/${f}`).join(' ');

  log(`运行: ${testFiles.join(', ')}`);
  console.log();

  try {
    execSync(`npm test -- ${testPatterns}`, {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch (error) {
    // Jest 失败
  }
}

// ============================================================================
// 交互式演示
// ============================================================================

async function interactiveDemo() {
  header('🎯 TiaCC 演示 - 测试影响分析');

  console.log('这个演示将展示 TiaCC 如何：');
  console.log('  1. 收集代码覆盖率');
  console.log('  2. 构建源文件→测试的映射');
  console.log('  3. 根据变更推荐测试\n');

  // 步骤 1
  await sleep(500);
  const coverage = await runTestsWithCoverage();

  if (!coverage) {
    log('演示中断：无法获取覆盖率数据', 'error');
    process.exit(1);
  }

  // 步骤 2
  await sleep(500);
  buildMappingDatabase(coverage);

  // 步骤 3: 模拟不同的修改场景
  await sleep(500);
  header('📊 场景模拟');

  console.log('假设你修改了不同的文件，看看需要运行哪些测试：\n');

  // 场景 1
  console.log('\x1b[1m场景 1: 修改 calculator.js\x1b[0m');
  const affected1 = getAffectedTests(['calculator.js']);
  console.log();

  // 场景 2
  console.log('\x1b[1m场景 2: 修改 statistics.js\x1b[0m');
  const affected2 = getAffectedTests(['statistics.js']);
  console.log();

  // 场景 3
  console.log('\x1b[1m场景 3: 修改 formatter.js\x1b[0m');
  const affected3 = getAffectedTests(['formatter.js']);
  console.log();

  // 场景 4
  console.log('\x1b[1m场景 4: 同时修改 calculator.js 和 statistics.js\x1b[0m');
  const affected4 = getAffectedTests(['calculator.js', 'statistics.js']);

  // 总结
  header('📈 效果对比');

  const allTests = 4;
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  修改文件              │ 全量测试  │ TiaCC 推荐   │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│  calculator.js         │    ${allTests}      │      ${affected1.length}       │`);
  console.log(`│  statistics.js         │    ${allTests}      │      ${affected2.length}       │`);
  console.log(`│  formatter.js          │    ${allTests}      │      ${affected3.length}       │`);
  console.log(`│  calculator + stats    │    ${allTests}      │      ${affected4.length}       │`);
  console.log('└─────────────────────────────────────────────────────┘');
  console.log();

  log('演示完成! 数据库保存在 impact_map.db', 'success');
  console.log('\n试试这些命令:');
  console.log('  node demo.js --affected calculator.js');
  console.log('  node demo.js --affected statistics.js formatter.js');
  console.log();
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // 确保依赖已安装
  if (!existsSync(join(__dirname, 'node_modules'))) {
    log('正在安装依赖...', 'info');
    execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
  }

  if (args.includes('--full')) {
    // 运行全量测试
    const coverage = await runTestsWithCoverage();
    if (coverage) {
      buildMappingDatabase(coverage);
    }
  } else if (args.includes('--affected')) {
    // 查询受影响的测试
    const idx = args.indexOf('--affected');
    const changedFiles = args.slice(idx + 1);

    if (changedFiles.length === 0) {
      log('请指定变更的文件，例如: node demo.js --affected calculator.js', 'error');
      process.exit(1);
    }

    if (!existsSync(CONFIG.dbPath)) {
      log('请先运行 node demo.js --full 构建映射数据库', 'error');
      process.exit(1);
    }

    const affected = getAffectedTests(changedFiles);
    await runAffectedTests(affected);
  } else {
    // 交互式演示
    await interactiveDemo();
  }
}

main().catch(console.error);
