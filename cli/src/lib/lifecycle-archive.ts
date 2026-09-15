import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const JSZip = require('jszip') as any;

export interface ArchiveEntryRecord {
  path: string;
  size: number;
  checksum: string;
}

export interface ArchiveBuildResult {
  archivePath: string;
  checksum: string;
  entryCount: number;
  entries: ArchiveEntryRecord[];
}

export interface ArchiveExtractionResult {
  entryCount: number;
  extractedPaths: string[];
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  return new Promise<string>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function normalizeArchivePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isUnsafeArchivePath(entryPath: string): boolean {
  const normalized = path.posix.normalize(entryPath);
  return (
    normalized.startsWith('../') ||
    normalized === '..' ||
    path.posix.isAbsolute(normalized) ||
    normalized.includes('\0')
  );
}

function ensureInsideRoot(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    resolvedTarget === resolvedRoot
  ) {
    if (resolvedTarget !== resolvedRoot) {
      throw new Error(`Archive entry resolves outside the destination root: ${target}`);
    }
  }
}

function isSymlinkEntry(entry: any): boolean {
  const unixPermissions = typeof entry?.unixPermissions === 'number'
    ? entry.unixPermissions
    : undefined;

  if (typeof unixPermissions === 'number') {
    return (unixPermissions & 0o170000) === 0o120000;
  }

  const externalFileAttrs = typeof entry?.externalFileAttrs === 'number'
    ? entry.externalFileAttrs
    : undefined;

  if (typeof externalFileAttrs === 'number') {
    return (externalFileAttrs >>> 16 & 0o170000) === 0o120000;
  }

  return false;
}

async function walkDirectory(
  sourceDir: string,
  relativeRoot: string,
  zip: any,
  entries: ArchiveEntryRecord[]
): Promise<void> {
  const dirEntries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const dirent of dirEntries) {
    const fullPath = path.join(sourceDir, dirent.name);
    const relativePath = normalizeArchivePath(path.relative(relativeRoot, fullPath));

    if (dirent.isSymbolicLink()) {
      continue;
    }

    if (dirent.isDirectory()) {
      await walkDirectory(fullPath, relativeRoot, zip, entries);
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    const content = await fs.promises.readFile(fullPath);
    const checksum = sha256Buffer(content);
    const stat = await fs.promises.stat(fullPath);
    zip.file(relativePath, content, {
      date: stat.mtime,
      createFolders: true
    });
    entries.push({
      path: relativePath,
      size: content.length,
      checksum
    });
  }
}

export async function createZipArchiveFromDirectory(
  sourceDir: string,
  archivePath: string
): Promise<ArchiveBuildResult> {
  const zip = new JSZip();
  const entries: ArchiveEntryRecord[] = [];
  const resolvedSourceDir = path.resolve(sourceDir);

  if (!fs.existsSync(resolvedSourceDir)) {
    throw new Error(`Source directory does not exist: ${resolvedSourceDir}`);
  }

  await walkDirectory(resolvedSourceDir, resolvedSourceDir, zip, entries);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.promises.writeFile(archivePath, buffer);

  return {
    archivePath,
    checksum: sha256Buffer(buffer),
    entryCount: entries.length,
    entries
  };
}

export async function extractZipArchiveSafely(
  archivePath: string,
  destinationDir: string
): Promise<ArchiveExtractionResult> {
  const resolvedDestination = path.resolve(destinationDir);
  const buffer = await fs.promises.readFile(archivePath);
  const zip = await JSZip.loadAsync(buffer);
  const extractedPaths: string[] = [];

  await fs.promises.mkdir(resolvedDestination, { recursive: true });

  for (const entry of Object.values(zip.files) as any[]) {
    const entryPath = normalizeArchivePath(String(entry.name ?? ''));

    if (!entryPath || entryPath === '/') {
      continue;
    }

    if (isUnsafeArchivePath(entryPath)) {
      throw new Error(`Unsafe archive path rejected: ${entryPath}`);
    }

    if (isSymlinkEntry(entry)) {
      throw new Error(`Symlink archive entry rejected: ${entryPath}`);
    }

    const targetPath = path.resolve(resolvedDestination, entryPath);
    ensureInsideRoot(resolvedDestination, targetPath);

    if (entry.dir) {
      await fs.promises.mkdir(targetPath, { recursive: true });
      continue;
    }

    const content = await entry.async('nodebuffer');
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, content);
    extractedPaths.push(targetPath);
  }

  return {
    entryCount: extractedPaths.length,
    extractedPaths
  };
}

export async function verifyArchiveChecksum(
  archivePath: string,
  expectedChecksum: string
): Promise<boolean> {
  const actualChecksum = await sha256File(archivePath);
  return actualChecksum === expectedChecksum;
}

