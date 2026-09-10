import * as fs from 'fs';
import * as path from 'path';

import { isValidSemanticVersion } from './module-system';

/**
 * Read the CLI package version from the installed package manifest.
 *
 * This keeps surfaced version strings aligned with the package metadata that
 * ships to users, while the repo-level VERSION file can continue to drive the
 * release sync workflow.
 */
export function readPackageVersion(): string {
  const packageJsonPath = path.join(__dirname, '../../../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    throw new Error(`package.json at ${packageJsonPath} is missing a version`);
  }

  if (!isValidSemanticVersion(packageJson.version)) {
    throw new Error(`Invalid semantic version in package.json: ${packageJson.version}`);
  }

  return packageJson.version.trim();
}
