import { describe, expect, it } from 'vitest';
import {
  compareSemanticVersions,
  isValidSemanticVersion,
  satisfiesVersionRange
} from '@cli/utils/module-system';

describe('versioning edge cases', () => {
  it('accepts valid build metadata and prerelease versions', () => {
    expect(isValidSemanticVersion('1.0.0-alpha.1+build.5')).toBe(true);
    expect(compareSemanticVersions('1.0.0-alpha.1+build.5', '1.0.0-alpha.1')).toBe(0);
  });

  it('handles prerelease ranges and exact matches consistently', () => {
    expect(satisfiesVersionRange('1.2.3-alpha.1', '^1.0.0')).toBe(true);
    expect(satisfiesVersionRange('1.2.3+build.7', '1.2.3')).toBe(true);
  });

  it('fails safely on malformed inputs', () => {
    expect(isValidSemanticVersion('not-a-version')).toBe(false);
    expect(satisfiesVersionRange('1.0.0', 'not-a-range')).toBe(false);
    expect(() => compareSemanticVersions('1.0.0', 'not-a-version')).toThrow(/Invalid semantic version format/);
  });
});
