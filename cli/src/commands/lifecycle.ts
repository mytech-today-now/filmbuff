import chalk from 'chalk';
import { Command } from 'commander';
import * as path from 'path';

import { redactLifecycleArtifact } from '../lib/lifecycle-artifact';
import {
  applyLifecycleRepairActions,
  detectLifecycleSnapshot,
  runLifecycleDiagnostics,
  runLifecycleRollback,
  runLifecycleUninstall,
  runWorkspaceInstallWithBackup
} from '../lib/lifecycle-manager';

type LifecycleReportFormat = 'json' | 'markdown' | 'html';
type LifecycleMode = 'fresh' | 'reinstall' | 'upgrade';

interface LifecycleProjectOptions {
  project?: string;
}

interface LifecycleJsonOptions extends LifecycleProjectOptions {
  json?: boolean;
}

interface LifecycleInstallOptions extends LifecycleJsonOptions {
  dryRun?: boolean;
}

interface LifecycleDiagnoseOptions extends LifecycleJsonOptions {
  dryRun?: boolean;
  format?: LifecycleReportFormat;
  output?: string;
}

interface LifecycleRepairOptions extends LifecycleJsonOptions {
  dryRun?: boolean;
}

interface LifecycleRollbackOptions extends LifecycleJsonOptions {
  dryRun?: boolean;
  backupId?: string;
}

interface LifecycleUninstallOptions extends LifecycleJsonOptions {
  dryRun?: boolean;
  removeData?: boolean;
  confirm?: boolean;
}

function resolveProjectPath(project?: string): string {
  return path.resolve(project ?? process.cwd());
}

function projectFlag(cmd: Command): Command {
  return cmd.option('-p, --project <path>', 'Project directory', process.cwd());
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function setExitCodeFromStatus(status: string): void {
  if (status !== 'success' && status !== 'dry-run') {
    process.exitCode = 1;
  }
}

function printSnapshotReport(projectRoot: string): void {
  const snapshot = detectLifecycleSnapshot(projectRoot);
  const artifact = snapshot.artifact ? redactLifecycleArtifact(snapshot.artifact) : null;

  console.log(chalk.blue('\nFilmBuff lifecycle status\n'));
  console.log(chalk.gray(`Project root: ${projectRoot}`));
  console.log(chalk.gray(`State: ${snapshot.state}`));
  console.log(chalk.gray(`Package version: ${snapshot.packageVersion}`));
  console.log(chalk.gray(`Installed version: ${snapshot.installedVersion ?? 'not recorded'}`));
  console.log(chalk.gray(`Previous version: ${snapshot.previousVersion ?? 'not recorded'}`));
  console.log(chalk.gray(`Rollback available: ${snapshot.rollbackAvailable ? 'yes' : 'no'}`));
  console.log(chalk.gray(`Upgrade available: ${snapshot.upgradeAvailable ? 'yes' : 'no'}`));
  console.log(chalk.gray(`Recovery required: ${snapshot.recoveryRequired ? 'yes' : 'no'}`));
  console.log(chalk.gray(`Artifact valid: ${snapshot.artifactValidation.valid ? 'yes' : 'no'}`));

  if (snapshot.artifactValidation.errors.length > 0) {
    console.log(chalk.yellow('\nValidation issues:'));
    for (const error of snapshot.artifactValidation.errors) {
      console.log(chalk.yellow(`  - ${error}`));
    }
  }

  if (artifact) {
    console.log(chalk.gray(`Artifact path: ${artifact.paths.artifactPath ?? 'not recorded'}`));
  }
}

async function runInstallMode(mode: LifecycleMode, options: LifecycleInstallOptions): Promise<void> {
  const result = await runWorkspaceInstallWithBackup({
    cwd: resolveProjectPath(options.project),
    dryRun: options.dryRun,
    mode
  });

  if (options.json) {
    printJson({
      status: result.status,
      artifact: redactLifecycleArtifact(result.artifact),
      warnings: result.warnings,
      errors: result.errors,
      reportPath: result.reportPath
    });
  } else {
    const label = mode === 'fresh' ? 'install' : mode;
    console.log(chalk.green(`Workspace ${label} ${result.status === 'dry-run' ? 'previewed' : 'completed'}.`));
    if (result.reportPath) {
      console.log(chalk.gray(`Report: ${result.reportPath}`));
    }
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`Warnings: ${result.warnings.join('; ')}`));
    }
    if (result.errors.length > 0) {
      console.log(chalk.red(`Errors: ${result.errors.join('; ')}`));
    }
  }

  setExitCodeFromStatus(result.status);
}

async function runDiagnostics(options: LifecycleDiagnoseOptions): Promise<void> {
  const result = await runLifecycleDiagnostics({
    cwd: resolveProjectPath(options.project),
    dryRun: options.dryRun,
    reportFormat: options.dryRun ? undefined : options.format,
    reportPath: options.dryRun ? undefined : options.output
  });

  if (options.json) {
    printJson({
      ...result,
      snapshot: {
        ...result.snapshot,
        artifact: result.snapshot.artifact ? redactLifecycleArtifact(result.snapshot.artifact) : null
      }
    });
  } else {
    console.log(chalk.blue('\nFilmBuff lifecycle diagnostics\n'));
    console.log(chalk.gray(`State: ${result.snapshot.state}`));
    console.log(chalk.gray(`Findings: ${result.findings.length}`));
    console.log(chalk.gray(`Critical: ${result.summary.critical}, High: ${result.summary.high}, Medium: ${result.summary.medium}, Low: ${result.summary.low}, Warning: ${result.summary.warning}`));

    for (const finding of result.findings) {
      const severityColor =
        finding.severity === 'critical' ? chalk.red :
        finding.severity === 'high' ? chalk.redBright :
        finding.severity === 'medium' ? chalk.yellow :
        finding.severity === 'low' ? chalk.green :
        chalk.cyan;

      console.log(severityColor(`- ${finding.title}`));
      console.log(chalk.gray(`  ${finding.explanation}`));
      if (finding.actions && finding.actions.length > 0) {
        console.log(chalk.gray(`  Actions: ${finding.actions.map((action) => action.id).join(', ')}`));
      }
    }

    if (result.reportPath) {
      console.log(chalk.gray(`Report: ${result.reportPath}`));
    }
  }

  setExitCodeFromStatus(result.status);
}

async function runRollback(options: LifecycleRollbackOptions): Promise<void> {
  const result = await runLifecycleRollback({
    cwd: resolveProjectPath(options.project),
    dryRun: options.dryRun,
    backupId: options.backupId
  });

  if (options.json) {
    printJson({
      ...result,
      artifact: redactLifecycleArtifact(result.artifact)
    });
  } else {
    console.log(chalk.blue('\nFilmBuff lifecycle rollback\n'));
    console.log(chalk.gray(`Status: ${result.status}`));
    console.log(chalk.gray(`Restored: ${result.restored ? 'yes' : 'no'}`));
    for (const step of result.steps) {
      console.log(chalk.gray(`- ${step}`));
    }
    if (result.backupZipPath) {
      console.log(chalk.gray(`Backup: ${result.backupZipPath}`));
    }
    if (result.reportPath) {
      console.log(chalk.gray(`Report: ${result.reportPath}`));
    }
  }

  setExitCodeFromStatus(result.status);
}

async function runUninstall(options: LifecycleUninstallOptions): Promise<void> {
  const result = await runLifecycleUninstall({
    cwd: resolveProjectPath(options.project),
    dryRun: options.dryRun,
    removeData: options.removeData,
    confirm: options.confirm
  });

  if (options.json) {
    printJson({
      ...result,
      artifact: redactLifecycleArtifact(result.artifact)
    });
  } else {
    console.log(chalk.blue('\nFilmBuff lifecycle uninstall\n'));
    console.log(chalk.gray(`Status: ${result.status}`));
    console.log(chalk.gray(`Removed: ${result.removedPaths.length}`));
    console.log(chalk.gray(`Preserved: ${result.preservedPaths.length}`));
    console.log(chalk.gray(`Archived: ${result.archivedPaths.length}`));
    if (result.archivePath) {
      console.log(chalk.gray(`Archive: ${result.archivePath}`));
    }
    if (result.reportPath) {
      console.log(chalk.gray(`Report: ${result.reportPath}`));
    }
  }

  setExitCodeFromStatus(result.status);
}

async function runRecovery(options: LifecycleRepairOptions): Promise<void> {
  const projectRoot = resolveProjectPath(options.project);
  const diagnostics = await runLifecycleDiagnostics({
    cwd: projectRoot,
    dryRun: options.dryRun
  });

  const repairActionIds = Array.from(
    new Set(
      diagnostics.findings.flatMap((finding) =>
        (finding.actions ?? [])
          .filter((action) => action.safe && !action.destructive)
          .map((action) => action.id)
      )
    )
  );

  if (repairActionIds.length === 0) {
    if (options.json) {
      printJson({
        status: 'success',
        diagnostics: {
          ...diagnostics,
          snapshot: {
            ...diagnostics.snapshot,
            artifact: diagnostics.snapshot.artifact ? redactLifecycleArtifact(diagnostics.snapshot.artifact) : null
          }
        },
        repair: { status: 'success', artifact: diagnostics.snapshot.artifact ? redactLifecycleArtifact(diagnostics.snapshot.artifact) : null, warnings: [], errors: [] }
      });
    } else {
      console.log(chalk.green('No safe recovery actions were available.'));
    }
    setExitCodeFromStatus(diagnostics.status);
    return;
  }

  const repair = await applyLifecycleRepairActions(repairActionIds, {
    cwd: projectRoot,
    dryRun: options.dryRun
  });

  if (options.json) {
    printJson({
      diagnostics: {
        ...diagnostics,
        snapshot: {
          ...diagnostics.snapshot,
          artifact: diagnostics.snapshot.artifact ? redactLifecycleArtifact(diagnostics.snapshot.artifact) : null
        }
      },
      repair: {
        ...repair,
        artifact: redactLifecycleArtifact(repair.artifact)
      }
    });
  } else {
    console.log(chalk.blue('\nFilmBuff lifecycle recovery\n'));
    console.log(chalk.gray(`Diagnostics findings: ${diagnostics.findings.length}`));
    console.log(chalk.gray(`Applied actions: ${repairActionIds.join(', ')}`));
    for (const warning of repair.warnings) {
      console.log(chalk.yellow(`- ${warning}`));
    }
    for (const error of repair.errors) {
      console.log(chalk.red(`- ${error}`));
    }
  }

  setExitCodeFromStatus(repair.status);
}

async function runRepair(actions: string[], options: LifecycleRepairOptions): Promise<void> {
  const actionIds = actions.map((action) => action.trim()).filter(Boolean);
  const result = await applyLifecycleRepairActions(actionIds, {
    cwd: resolveProjectPath(options.project),
    dryRun: options.dryRun
  });

  if (options.json) {
    printJson({
      ...result,
      artifact: redactLifecycleArtifact(result.artifact)
    });
  } else {
    console.log(chalk.blue('\nFilmBuff lifecycle repair\n'));
    console.log(chalk.gray(`Status: ${result.status}`));
    console.log(chalk.gray(`Actions: ${actionIds.length > 0 ? actionIds.join(', ') : 'none'}`));
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`- ${warning}`));
    }
    for (const error of result.errors) {
      console.log(chalk.red(`- ${error}`));
    }
  }

  setExitCodeFromStatus(result.status);
}

export function registerLifecycleCommands(program: Command): Command {
  const lifecycleCmd = program
    .command('lifecycle')
    .description('Manage workspace lifecycle, diagnostics, repair, rollback, and uninstall flows');

  projectFlag(
    lifecycleCmd.command('status')
      .description('Show the current lifecycle state')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleJsonOptions) => {
    const projectRoot = resolveProjectPath(options.project);
    const snapshot = detectLifecycleSnapshot(projectRoot);

    if (options.json) {
      printJson({
        ...snapshot,
        artifact: snapshot.artifact ? redactLifecycleArtifact(snapshot.artifact) : null
      });
      return;
    }

    printSnapshotReport(projectRoot);
  });

  projectFlag(
    lifecycleCmd.command('install')
      .description('Install FilmBuff lifecycle artifacts into the current workspace')
      .option('--dry-run', 'Preview installation without writing files')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleInstallOptions) => runInstallMode('fresh', options));

  projectFlag(
    lifecycleCmd.command('reinstall')
      .description('Reinstall lifecycle artifacts while preserving compatible workspace state')
      .option('--dry-run', 'Preview installation without writing files')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleInstallOptions) => runInstallMode('reinstall', options));

  projectFlag(
    lifecycleCmd.command('upgrade')
      .description('Upgrade lifecycle artifacts and record a rollback point')
      .option('--dry-run', 'Preview installation without writing files')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleInstallOptions) => runInstallMode('upgrade', options));

  projectFlag(
    lifecycleCmd.command('diagnose')
      .description('Analyze lifecycle state and emit a diagnostics report')
      .option('--dry-run', 'Run analysis without writing a report file')
      .option('--format <format>', 'Report format: json, markdown, html', 'markdown')
      .option('--output <path>', 'Write the report to a custom path')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleDiagnoseOptions) => runDiagnostics(options));

  projectFlag(
    lifecycleCmd.command('recover')
      .description('Run diagnostics and apply the safe repair actions that are available')
      .option('--dry-run', 'Preview recovery without making changes')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleRepairOptions) => runRecovery(options));

  projectFlag(
    lifecycleCmd.command('repair [actions...]')
      .description('Apply one or more explicit lifecycle repair actions')
      .option('--dry-run', 'Preview the repair actions without making changes')
      .option('--json', 'Output as JSON')
  ).action((actions: string[] = [], options: LifecycleRepairOptions) => runRepair(Array.isArray(actions) ? actions : [], options));

  projectFlag(
    lifecycleCmd.command('rollback')
      .description('Restore the most recent verified backup or a chosen backup')
      .option('--backup-id <id>', 'Restore a specific backup id')
      .option('--dry-run', 'Preview rollback without restoring files')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleRollbackOptions) => runRollback(options));

  projectFlag(
    lifecycleCmd.command('uninstall')
      .description('Remove FilmBuff lifecycle artifacts from the workspace')
      .option('--remove-data', 'Remove Beads and workspace data as well')
      .option('--confirm', 'Confirm the uninstall without an interactive prompt')
      .option('--dry-run', 'Preview uninstall without removing files')
      .option('--json', 'Output as JSON')
  ).action((options: LifecycleUninstallOptions) => runUninstall(options));

  return lifecycleCmd;
}
