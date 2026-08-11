const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');
const vitestEntrypoint = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
const vitestConfig = path.join(repoRoot, 'vitest.config.ts');
const vitestLoader = path.join(repoRoot, 'scripts', 'vitest-loader.mjs');

if (!fs.existsSync(vitestEntrypoint)) {
  console.error('Vitest test lane is configured but the local vitest dependency is not installed.');
  console.error('Install it with an explicit dependency update, then rerun the command:');
  console.error('  npm install -D vitest');
  process.exit(1);
}

const args = process.argv.slice(2);
const vitestArgs = args.length > 0 ? args : ['run'];

if (!vitestArgs.includes('--config')) {
  vitestArgs.push('--config', vitestConfig);
}

const result = spawnSync(process.execPath, ['--loader', pathToFileURL(vitestLoader).href, vitestEntrypoint, ...vitestArgs], {
  cwd: repoRoot,
  stdio: 'inherit'
});

if (result.error) {
  console.error('Failed to launch Vitest:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
