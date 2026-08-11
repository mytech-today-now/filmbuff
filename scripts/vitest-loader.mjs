import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(scriptDir, '..');
const vitestUtilsDist = resolvePath(repoRoot, 'node_modules', '@vitest', 'utils', 'dist');

function resolveVitestUtilsSubpath(specifier) {
  const subpath = specifier.slice('@vitest/utils/'.length);
  const directFile = resolvePath(vitestUtilsDist, `${subpath}.js`);

  if (existsSync(directFile)) {
    return pathToFileURL(directFile).href;
  }

  const nestedFile = resolvePath(vitestUtilsDist, subpath);
  if (existsSync(nestedFile)) {
    return pathToFileURL(nestedFile).href;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@vitest/utils/')) {
    const redirected = resolveVitestUtilsSubpath(specifier);
    if (redirected) {
      return { url: redirected, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
