import * as fs from 'fs';
import * as path from 'path';
import {
  parseSemanticVersion,
  compareSemanticVersions,
  isValidSemanticVersion,
  type SemanticVersion
} from '../utils/module-system';

/**
 * Version metadata interface
 */
export interface VersionMetadata {
  version: string;
  publishedAt?: Date;
  deprecated?: boolean;
  deprecationMessage?: string;
  breaking?: boolean;
  changelog?: string;
}

/**
 * Version cache entry
 */
interface FileFreshness {
  exists: boolean;
  size?: bigint;
  mtimeNs?: bigint;
}

/**
 * File freshness probe result used to validate cached metadata.
 */
interface VersionCacheEntry {
  metadata: VersionMetadata;
  timestamp: number;
  versionFreshness: FileFreshness;
  metadataFreshness: FileFreshness;
}

/**
 * VersionManager class
 * Manages module versions including loading, caching, and comparison
 */
export class VersionManager {
  private cache: Map<string, VersionCacheEntry> = new Map();
  private cacheTTL: number = 3600000; // 1 hour in milliseconds

  /**
   * Get version metadata for a module
   * @param modulePath Path to the module directory
   * @returns Version metadata or null if not found
   */
  getVersion(modulePath: string): VersionMetadata | null {
    // Check cache first
    const cached = this.cache.get(modulePath);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      const freshness = this.isCacheFresh(modulePath, cached);
      if (freshness === true) {
        return cached.metadata;
      }

      if (freshness === null) {
        console.warn('Version metadata could not be confirmed from cache. Reloading from disk.');
      }
    }

    // Load from VERSION file
    const versionFile = path.join(modulePath, 'VERSION');
    const versionFreshness = this.getFileFreshness(versionFile);
    if (versionFreshness === null || !versionFreshness.exists) {
      return null;
    }

    try {
      const version = fs.readFileSync(versionFile, 'utf-8').trim();
      
      if (!isValidSemanticVersion(version)) {
        return null;
      }

      // Load additional metadata if available
      const metadataFile = path.join(modulePath, 'metadata.json');
      const metadataFreshness = this.getFileFreshness(metadataFile);
      if (metadataFreshness === null) {
        return null;
      }

      let metadata: VersionMetadata = { version };

      if (metadataFreshness.exists) {
        const metadataContent = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
        metadata = {
          version,
          publishedAt: metadataContent.publishedAt ? new Date(metadataContent.publishedAt) : undefined,
          deprecated: metadataContent.deprecated || false,
          deprecationMessage: metadataContent.deprecationMessage,
          breaking: metadataContent.breaking || false,
          changelog: metadataContent.changelog
        };
      }

      // Cache the result
      this.cache.set(modulePath, {
        metadata,
        timestamp: Date.now(),
        versionFreshness,
        metadataFreshness
      });

      return metadata;
    } catch {
      return null;
    }
  }

  /**
   * Set version for a module
   * @param modulePath Path to the module directory
   * @param version Version string (must be valid semver)
   * @returns True if successful, false otherwise
   */
  setVersion(modulePath: string, version: string): boolean {
    if (!isValidSemanticVersion(version)) {
      return false;
    }

    try {
      const versionFile = path.join(modulePath, 'VERSION');
      fs.writeFileSync(versionFile, version + '\n', 'utf-8');

      // Invalidate cache
      this.cache.delete(modulePath);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Compare two versions
   * @param v1 First version string
   * @param v2 Second version string
   * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
   */
  compareVersions(v1: string, v2: string): number {
    return compareSemanticVersions(v1, v2);
  }

  /**
   * Parse version string into components
   * @param version Version string
   * @returns Parsed semantic version or null if invalid
   */
  parseVersion(version: string): SemanticVersion | null {
    return parseSemanticVersion(version);
  }

  /**
   * Check if version is deprecated
   * @param modulePath Path to the module directory
   * @returns True if deprecated, false otherwise
   */
  isDeprecated(modulePath: string): boolean {
    const metadata = this.getVersion(modulePath);
    return metadata?.deprecated || false;
  }

  /**
   * Clear version cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Set cache TTL
   * @param ttl Time to live in milliseconds
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }

  /**
   * Probe file freshness with high-resolution file metadata.
   * Returns null when freshness cannot be confirmed safely.
   */
  private getFileFreshness(filePath: string): FileFreshness | null {
    try {
      const stats = fs.statSync(filePath, { bigint: true });
      return {
        exists: true,
        size: stats.size,
        mtimeNs: stats.mtimeNs
      };
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return { exists: false };
      }

      return null;
    }
  }

  /**
   * Check whether a cached entry still matches the current on-disk files.
   */
  private isCacheFresh(modulePath: string, cached: VersionCacheEntry): boolean | null {
    const versionFile = path.join(modulePath, 'VERSION');
    const currentVersionFreshness = this.getFileFreshness(versionFile);
    if (currentVersionFreshness === null) {
      return null;
    }

    if (!this.isSameFreshness(cached.versionFreshness, currentVersionFreshness)) {
      return false;
    }

    const metadataFile = path.join(modulePath, 'metadata.json');
    const currentMetadataFreshness = this.getFileFreshness(metadataFile);
    if (currentMetadataFreshness === null) {
      return null;
    }

    if (!this.isSameFreshness(cached.metadataFreshness, currentMetadataFreshness)) {
      return false;
    }

    return true;
  }

  /**
   * Compare two freshness probes.
   */
  private isSameFreshness(left: FileFreshness, right: FileFreshness): boolean {
    if (left.exists !== right.exists) {
      return false;
    }

    if (!left.exists) {
      return true;
    }

    return left.size === right.size && left.mtimeNs === right.mtimeNs;
  }

  /**
   * Detect missing-file errors without treating other failures as cache-safe.
   */
  private isMissingFileError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

