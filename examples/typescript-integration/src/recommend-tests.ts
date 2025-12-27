/**
 * Example: Getting recommended tests based on code changes
 *
 * This script demonstrates how to get the list of tests
 * affected by recent code changes.
 *
 * Typically run in PR/MR checks.
 */

import { TiaCC } from '@tiacc/tools';
import { writeFileSync } from 'fs';

async function main() {
  console.log('='.repeat(60));
  console.log('TiaCC - Test Recommendation');
  console.log('='.repeat(60));
  console.log();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const baseBranch = args.find(a => a.startsWith('--branch='))?.split('=')[1] || 'origin/main';
  const outputFile = args.find(a => a.startsWith('--output='))?.split('=')[1];
  const level = (args.find(a => a.startsWith('--level='))?.split('=')[1] || 'file') as 'file' | 'function';

  // Initialize TiaCC
  const tia = await TiaCC.init({
    dbPath: './impact_map.db',
    verbose: true,
  });

  try {
    console.log(`Analyzing changes against: ${baseBranch}`);
    console.log(`Analysis level: ${level}`);
    console.log();

    // Get affected tests
    const result = await tia.getAffectedTests({
      baseBranch,
      level,
      includeUntracked: false,
    });

    // Print results
    console.log('Analysis Results:');
    console.log('-'.repeat(40));
    console.log(`  Changed files:    ${result.changedFiles.length}`);
    console.log(`  Affected tests:   ${result.tests.length}`);
    console.log(`  Total tests:      ${result.totalTests}`);
    console.log(`  Savings:          ${result.savingsPercent}%`);
    console.log();

    if (result.changedFiles.length > 0) {
      console.log('Changed files:');
      for (const file of result.changedFiles) {
        console.log(`  - ${file}`);
      }
      console.log();
    }

    if (result.tests.length > 0) {
      console.log('Recommended tests:');
      for (const test of result.tests) {
        console.log(`  - ${test}`);
      }
      console.log();

      // Write to file if requested
      if (outputFile) {
        writeFileSync(outputFile, result.tests.join('\n') + '\n');
        console.log(`Tests written to: ${outputFile}`);
      }
    } else {
      console.log('No tests affected by the changes.');
    }

    // Print function-level details if available
    if (result.details?.changedSymbols && result.details.changedSymbols.length > 0) {
      console.log();
      console.log('Changed functions:');
      for (const symbol of result.details.changedSymbols) {
        console.log(`  - ${symbol}`);
      }
    }

    // Exit with appropriate code
    if (result.tests.length === 0 && result.changedFiles.length > 0) {
      console.log();
      console.log('Warning: Changes detected but no mapping found.');
      console.log('Consider running full test suite or updating the mapping.');
      process.exit(2);
    }

  } finally {
    tia.close();
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
