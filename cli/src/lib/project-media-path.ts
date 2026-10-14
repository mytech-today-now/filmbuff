import * as fsPromises from 'fs/promises';
import * as path from 'path';

export const INVALID_PROJECT_MEDIA_PATH = 'INVALID_PROJECT_MEDIA_PATH';

const INVALID_MEDIA_PATH_MESSAGE =
  'Video media paths must identify a regular file using a non-empty project-relative path. Absolute paths, parent traversal, and symbolic-link components are not allowed.';

export class ProjectMediaPathError extends Error {
  readonly code = INVALID_PROJECT_MEDIA_PATH;

  constructor() {
    super(INVALID_MEDIA_PATH_MESSAGE);
    this.name = 'ProjectMediaPathError';
  }
}

export type ProjectMediaPathResolution = {
  projectRoot: string;
  absolutePath: string;
  relativePath: string;
} & (
  | { kind: 'file' }
  | { kind: 'missing' }
);

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function invalidPath(): never {
  throw new ProjectMediaPathError();
}

function isParentSegment(segment: string): boolean {
  return segment === '..'
    || segment.replace(/ +$/g, '') === '..'
    || /^\.\.[. ]+$/.test(segment);
}

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

/**
 * Resolve an untrusted status-file media path below a canonical project root.
 * Missing paths are returned explicitly so lifecycle operations can preserve
 * their existing missing-source outcome. All other filesystem errors throw.
 */
export async function resolveProjectMediaPath(
  projectPath: string,
  mediaPath: string,
): Promise<ProjectMediaPathResolution> {
  if (
    typeof mediaPath !== 'string'
    || mediaPath.length === 0
    || mediaPath.includes('\0')
    || path.posix.isAbsolute(mediaPath)
    || path.win32.isAbsolute(mediaPath)
    || /^[a-zA-Z]:/.test(mediaPath)
  ) {
    return invalidPath();
  }

  const segments = mediaPath.replace(/\\/g, '/').split('/');
  if (mediaPath.endsWith('/') || mediaPath.endsWith('\\')) return invalidPath();

  const relativeSegments: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (isParentSegment(segment) || /^[a-zA-Z]:/.test(segment)) {
      return invalidPath();
    }
    relativeSegments.push(segment);
  }
  if (relativeSegments.length === 0) return invalidPath();

  const projectRoot = await fsPromises.realpath(projectPath);
  const rootStats = await fsPromises.lstat(projectRoot);
  if (!rootStats.isDirectory()) return invalidPath();

  const absolutePath = path.resolve(projectRoot, ...relativeSegments);
  if (!isInsideRoot(projectRoot, absolutePath)) return invalidPath();

  let currentPath = projectRoot;
  for (let index = 0; index < relativeSegments.length; index += 1) {
    currentPath = path.join(currentPath, relativeSegments[index]);
    let stats: Awaited<ReturnType<typeof fsPromises.lstat>>;
    try {
      stats = await fsPromises.lstat(currentPath);
    } catch (error: unknown) {
      if (isMissingPathError(error)) {
        return {
          kind: 'missing',
          projectRoot,
          absolutePath,
          relativePath: path.relative(projectRoot, absolutePath),
        };
      }
      throw error;
    }

    if (stats.isSymbolicLink()) return invalidPath();
    const isLeaf = index === relativeSegments.length - 1;
    if (isLeaf ? !stats.isFile() : !stats.isDirectory()) return invalidPath();
  }

  const canonicalTarget = await fsPromises.realpath(absolutePath);
  if (!isInsideRoot(projectRoot, canonicalTarget)) return invalidPath();

  return {
    kind: 'file',
    projectRoot,
    absolutePath: canonicalTarget,
    relativePath: path.relative(projectRoot, canonicalTarget),
  };
}
