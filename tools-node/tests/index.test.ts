/**
 * Unit tests for the main index module exports.
 */

import { describe, it, expect } from 'vitest';
import * as TiaccModule from '../src/index.js';

describe('Index exports', () => {
  describe('High-level API exports', () => {
    it('should export TiaCC class', () => {
      expect(TiaccModule.TiaCC).toBeDefined();
      expect(typeof TiaccModule.TiaCC).toBe('function');
    });

    it('should export createTiaCC function', () => {
      expect(TiaccModule.createTiaCC).toBeDefined();
      expect(typeof TiaccModule.createTiaCC).toBe('function');
    });
  });

  describe('Low-level component exports', () => {
    it('should export Database and initDatabase', () => {
      expect(TiaccModule.Database).toBeDefined();
      expect(TiaccModule.initDatabase).toBeDefined();
      expect(typeof TiaccModule.initDatabase).toBe('function');
    });

    it('should export coverage parser classes', () => {
      expect(TiaccModule.CoverageParser).toBeDefined();
      expect(TiaccModule.CppCoverageParser).toBeDefined();
      expect(TiaccModule.CSharpCoverageParser).toBeDefined();
      expect(TiaccModule.LlvmJsonCoverageParser).toBeDefined();
      expect(TiaccModule.CoberturaCoverageParser).toBeDefined();
      expect(TiaccModule.LcovCoverageParser).toBeDefined();
      expect(TiaccModule.JacocoCoverageParser).toBeDefined();
      expect(TiaccModule.IstanbulCoverageParser).toBeDefined();
      expect(TiaccModule.CoveragePyCoverageParser).toBeDefined();
      expect(TiaccModule.DotCoverCoverageParser).toBeDefined();
    });

    it('should export getParserForFile function', () => {
      expect(TiaccModule.getParserForFile).toBeDefined();
      expect(typeof TiaccModule.getParserForFile).toBe('function');
    });

    it('should export GitUtils', () => {
      expect(TiaccModule.GitUtils).toBeDefined();
      expect(typeof TiaccModule.GitUtils).toBe('function');
    });

    it('should export SymbolExtractor', () => {
      expect(TiaccModule.SymbolExtractor).toBeDefined();
      expect(typeof TiaccModule.SymbolExtractor).toBe('function');
    });
  });

  describe('Error handling exports', () => {
    it('should export error classes', () => {
      expect(TiaccModule.TiaError).toBeDefined();
      expect(TiaccModule.DatabaseError).toBeDefined();
      expect(TiaccModule.CoverageParseError).toBeDefined();
      expect(TiaccModule.GitError).toBeDefined();
      expect(TiaccModule.ConfigError).toBeDefined();
      expect(TiaccModule.IpcError).toBeDefined();
    });

    it('should export error handling functions', () => {
      expect(TiaccModule.handleError).toBeDefined();
      expect(typeof TiaccModule.handleError).toBe('function');
      expect(TiaccModule.formatErrorMessage).toBeDefined();
      expect(typeof TiaccModule.formatErrorMessage).toBe('function');
    });
  });

  describe('Parser factory function', () => {
    it('should create appropriate parser for coverage.json files', () => {
      const parser = TiaccModule.getParserForFile('test.coverage.json');
      expect(parser).toBeInstanceOf(TiaccModule.CSharpCoverageParser);
    });

    it('should create appropriate parser for cov.json files', () => {
      const parser = TiaccModule.getParserForFile('test.cov.json');
      expect(parser).toBeInstanceOf(TiaccModule.LlvmJsonCoverageParser);
    });

    it('should create appropriate parser for cobertura.xml files', () => {
      const parser = TiaccModule.getParserForFile('cobertura.xml');
      expect(parser).toBeInstanceOf(TiaccModule.CoberturaCoverageParser);
    });

    it('should create appropriate parser for lcov.info files', () => {
      const parser = TiaccModule.getParserForFile('coverage.info');
      expect(parser).toBeInstanceOf(TiaccModule.LcovCoverageParser);
    });

    it('should return null for unknown file types', () => {
      const parser = TiaccModule.getParserForFile('unknown.xyz');
      expect(parser).toBeNull();
    });
  });

  describe('Error class instantiation', () => {
    it('should create TiaError instances', () => {
      const error = new TiaccModule.TiaError('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TiaccModule.TiaError);
      expect(error.message).toBe('Test error');
    });

    it('should create DatabaseError instances', () => {
      const error = new TiaccModule.DatabaseError('DB error', 'testOp');
      expect(error).toBeInstanceOf(TiaccModule.TiaError);
      expect(error).toBeInstanceOf(TiaccModule.DatabaseError);
      expect(error.message).toBe('DB error');
    });

    it('should create GitError instances', () => {
      const error = new TiaccModule.GitError('Git error', 'testOp');
      expect(error).toBeInstanceOf(TiaccModule.TiaError);
      expect(error).toBeInstanceOf(TiaccModule.GitError);
      expect(error.message).toBe('Git error');
    });

    it('should create CoverageParseError instances', () => {
      const error = new TiaccModule.CoverageParseError('Parse error', 'test.json');
      expect(error).toBeInstanceOf(TiaccModule.TiaError);
      expect(error).toBeInstanceOf(TiaccModule.CoverageParseError);
      expect(error.message).toBe('Parse error');
    });
  });

  describe('Error formatting', () => {
    it('should format error messages', () => {
      const error = new Error('Test error');
      const formatted = TiaccModule.formatErrorMessage(error);
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Test error');
    });

    it('should format TiaError messages with context', () => {
      const error = new TiaccModule.DatabaseError('DB error', 'insert');
      const formatted = TiaccModule.formatErrorMessage(error);
      expect(formatted).toContain('DB error');
    });
  });
});
