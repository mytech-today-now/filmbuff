#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const semver = require("semver");

const repoRoot = path.resolve(__dirname, "..");
const versionPath = path.join(repoRoot, "VERSION");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageLockPath = path.join(repoRoot, "package-lock.json");
const readmePath = path.join(repoRoot, "README.md");
const helpPath = path.join(repoRoot, ".augment", "COMMAND_HELP.md");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force") || args.has("--yes");

function fail(message) {
  console.error(`Version sync failed: ${message}`);
  process.exit(1);
}

function readVersion() {
  if (!fs.existsSync(versionPath)) {
    fail(`VERSION file not found at ${versionPath}`);
  }

  const version = fs.readFileSync(versionPath, "utf8").trim();
  if (!semver.valid(version)) {
    fail(`VERSION file contains an invalid semantic version: ${version}`);
  }

  return version;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}${os.EOL}`, "utf8");
}

function syncPackageJson(version) {
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const data = readJson(packageJsonPath);
  if (data.version === version) {
    return false;
  }

  data.version = version;
  if (!dryRun) {
    writeJson(packageJsonPath, data);
  }
  return true;
}

function syncPackageLock(version) {
  if (!fs.existsSync(packageLockPath)) {
    return false;
  }

  const data = readJson(packageLockPath);
  let changed = false;

  if (data.version !== version) {
    data.version = version;
    changed = true;
  }

  if (data.packages && data.packages[""] && data.packages[""].version !== version) {
    data.packages[""].version = version;
    changed = true;
  }

  if (changed && !dryRun) {
    writeJson(packageLockPath, data);
  }

  return changed;
}

function syncReadme(version) {
  if (!fs.existsSync(readmePath)) {
    return false;
  }

  const current = fs.readFileSync(readmePath, "utf8");
  const next = current.replace(
    /(https:\/\/img\.shields\.io\/badge\/version-)([0-9A-Za-z.+-]+)(-blue\.svg)/,
    `$1${version}$3`
  );

  if (next === current) {
    return false;
  }

  if (!dryRun) {
    fs.writeFileSync(readmePath, next, "utf8");
  }

  return true;
}

function syncCommandHelp(version) {
  if (!fs.existsSync(helpPath)) {
    return false;
  }

  const current = fs.readFileSync(helpPath, "utf8");
  const next = current.replace(/\*\*Version\*\*: [^\n]+/, `**Version**: ${version}`);

  if (next === current) {
    return false;
  }

  if (!dryRun) {
    fs.writeFileSync(helpPath, next, "utf8");
  }

  return true;
}

function promptForConfirmation(version) {
  if (dryRun || force || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(true);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`Sync version metadata to ${version}? [y/N] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

async function main() {
  const version = readVersion();
  const confirmed = await promptForConfirmation(version);

  if (!confirmed) {
    console.log("Version sync cancelled.");
    return;
  }

  const changes = [];

  if (syncPackageJson(version)) {
    changes.push("package.json");
  }

  if (syncPackageLock(version)) {
    changes.push("package-lock.json");
  }

  if (syncReadme(version)) {
    changes.push("README.md");
  }

  if (syncCommandHelp(version)) {
    changes.push(".augment/COMMAND_HELP.md");
  }

  if (dryRun) {
    if (changes.length === 0) {
      console.log(`Dry run: no version changes needed for ${version}.`);
    } else {
      console.log(`Dry run: would update ${changes.join(", ")} to ${version}.`);
    }
    return;
  }

  if (changes.length === 0) {
    console.log(`Version metadata already synchronized at ${version}.`);
    return;
  }

  console.log(`Updated ${changes.join(", ")} to ${version}.`);
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
