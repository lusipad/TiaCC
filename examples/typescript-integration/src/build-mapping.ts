/**
 * Example: Building the impact mapping database
 *
 * This script demonstrates how to programmatically build
 * the TiaCC impact mapping database from coverage data.
 *
 * Typically run in a nightly CI job after running all tests.
 */

import { TiaCC } from '@tiacc/tools';
import { resolve } from 'path';

async function main() {
  console.log('='.repeat(60));
  console.log('TiaCC - Building Impact Mapping Database');
  console.log('='.repeat(60));
  console.log();

  // Initialize TiaCC
  const tia = await TiaCC.init({
    dbPath: './impact_map.db',
    verbose: true,
    onLog: (message, level) => {
      const prefix = { info: '[INFO]', warn: '[WARN]', error: '[ERROR]' }[level];
      console.log(`${prefix} ${message}`);
    },
  });

  try {
    // Build the mapping from coverage data
    const result = await tia.buildMapping({
      coverageDir: './coverage',
      commitHash: process.env.GIT_COMMIT || undefined,
      clean: false,  // Set to true to clear existing mappings
    });

    // Print results
    console.log();
    console.log('Build Complete!');
    console.log('-'.repeat(40));
    console.log(`  Source files:  ${result.sourceFiles}`);
    console.log(`  Test scripts:  ${result.testScripts}`);
    console.log(`  Mappings:      ${result.mappings}`);
    console.log(`  Duration:      ${result.duration}ms`);
    console.log();

    // Get and print statistics
    const stats = tia.getStats();
    console.log('Database Statistics:');
    console.log('-'.repeat(40));
    console.log(`  Total source files:  ${stats.sourceFiles}`);
    console.log(`  Total test scripts:  ${stats.testScripts}`);
    console.log(`  Total mappings:      ${stats.mappings}`);
    console.log();

  } finally {
    tia.close();
  }
}

main().catch(console.error);
