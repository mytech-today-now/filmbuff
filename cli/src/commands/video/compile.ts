/**
 * cli/src/commands/video/compile.ts
 *
 * `filmbuff video compile`
 *
 * Assembles approved shots (default) into:
 *   combined.mp4   — ffmpeg concat in original JSONL order
 *   index.html     — fully self-contained HTML5 viewer
 *   project.zip    — all clips + HTML + pre-production docs
 *
 * --include approved (default) | all-complete | all
 * --title-cards (default: true)   2-second scene-title cards at scene boundaries
 * --output-dir <path>              default: video/output/
 *
 * Exit codes:
 *   0  SUCCESS       — compile complete
 *   2  NOT_FOUND     — required file/dir not found
 *   5  STATE_CONFLICT — zero eligible shots
 *   6  INVALID_ARGS  — invalid --include value or project not initialized
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-subcommands/spec.md §video compile
 * Beads: bd-92c1 (Phase 4 — WS-3)
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as child_process from 'child_process';
import * as util from 'util';
import { getLatestState } from '../../lib/status-file-manager.js';
import { readAll } from '../../lib/shot-list-reader.js';
import type { VideoStatusRecord } from '../../lib/shot-state-machine.js';
import {
  EXIT, isAgentMode, agentSuccess, agentError, humanLog,
} from '../../lib/agent-mode.js';

const exec = util.promisify(child_process.exec);

type IncludeMode = 'approved' | 'all-complete' | 'all';

export interface VideoCompileOptions {
  project:   string;
  include?:  string;
  titleCards?: boolean;
  outputDir?: string;
  agent?:    boolean;
}

/** Locate ffmpeg binary (FILMBUFF_FFMPEG_PATH or system PATH). */
function findFfmpeg(): string {
  return process.env['FILMBUFF_FFMPEG_PATH'] ?? 'ffmpeg';
}

/** Build a simple self-contained HTML5 video viewer for a list of clips. */
function buildIndexHtml(clips: Array<{ shotId: string; scene?: string; clipFile: string }>): string {
  const items = clips.map(c => `
    <div class="shot">
      <h3>${c.shotId}${c.scene ? ` — ${c.scene}` : ''}</h3>
      <video controls preload="metadata" src="${c.clipFile}" style="max-width:100%"></video>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FilmBuff — Video Review</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #eee; }
    h1 { color: #fff; } .shot { margin-bottom: 2rem; border-bottom: 1px solid #333; padding-bottom: 1rem; }
    h3 { margin: 0 0 .5rem; font-size: 1rem; color: #aaa; }
  </style>
</head>
<body>
  <h1>🎬 FilmBuff — Video Review</h1>
  ${items}
</body>
</html>`;
}

export async function videoCompileCommand(opts: VideoCompileOptions): Promise<void> {
  const projectPath = path.resolve(opts.project);
  const agentMode   = isAgentMode(opts.agent);
  const includeMode = (opts.include ?? 'approved') as IncludeMode;
  const titleCards  = opts.titleCards !== false;  // default true
  const outputDir   = path.resolve(opts.outputDir ?? path.join(projectPath, 'video', 'output'));
  const ffmpeg      = findFfmpeg();

  if (!['approved', 'all-complete', 'all'].includes(includeMode)) {
    const msg = `Invalid --include value: "${includeMode}". Use: approved | all-complete | all`;
    if (agentMode) { agentError(EXIT.INVALID_ARGS, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.INVALID_ARGS);
  }

  // ── Load shots + status ───────────────────────────────────────────────────
  let shots: Awaited<ReturnType<typeof readAll>>;
  try { shots = await readAll(projectPath); } catch (err) {
    const msg = `Cannot read shot list: ${(err as Error).message}`;
    if (agentMode) { agentError(EXIT.NOT_FOUND, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.NOT_FOUND);
  }

  const statusMap = await getLatestState(projectPath);

  // Filter shots by include mode (preserving JSONL order)
  const eligible = shots
    .map(s => ({ shot: s, record: statusMap.get(s.shot_id) as VideoStatusRecord | undefined }))
    .filter(({ record }) => {
      if (!record) return false;
      if (includeMode === 'approved')     return record.status === 'approved';
      if (includeMode === 'all-complete') return record.status === 'complete' || record.status === 'approved';
      return record.clip_path != null;   // 'all' — any shot with a clip
    })
    .filter(({ record }) => record!.clip_path != null);

  if (eligible.length === 0) {
    const msg = `No eligible shots for --include ${includeMode}. Zero shots have the required status.`;
    if (agentMode) { agentError(EXIT.STATE_CONFLICT, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(EXIT.STATE_CONFLICT);
  }

  await fsPromises.mkdir(outputDir, { recursive: true });

  // ── Build ffmpeg concat list ──────────────────────────────────────────────
  const concatLines: string[] = [];
  const clipItems: Array<{ shotId: string; scene?: string; clipFile: string }> = [];

  let lastScene: string | undefined;
  const titleCardDur = 2;

  for (const { shot, record } of eligible) {
    const absClip = path.resolve(projectPath, record!.clip_path!);

    if (titleCards && shot.scene && shot.scene !== lastScene) {
      // Write a title card using ffmpeg lavfi
      const titleFile = path.join(outputDir, `title_${shot.shot_id}.mp4`);
      const label     = shot.scene.replace(/'/g, "\\'");
      const titleCmd  =
        `${ffmpeg} -y -f lavfi -i "color=c=black:s=1920x1080:d=${titleCardDur}" ` +
        `-vf "drawtext=text='${label}':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" ` +
        `-t ${titleCardDur} -c:v libx264 -an "${titleFile}" 2>/dev/null`;
      try { await exec(titleCmd); concatLines.push(`file '${titleFile}'`); } catch { /* ffmpeg not found — skip title card */ }
      lastScene = shot.scene;
    }

    concatLines.push(`file '${absClip}'`);
    clipItems.push({ shotId: shot.shot_id, scene: shot.scene, clipFile: path.basename(record!.clip_path!) });
  }

  const concatFile = path.join(outputDir, 'concat.txt');
  await fsPromises.writeFile(concatFile, concatLines.join('\n') + '\n', 'utf-8');

  // ── Run ffmpeg concat ─────────────────────────────────────────────────────
  const combinedPath = path.join(outputDir, 'combined.mp4');
  humanLog(`→ Assembling ${eligible.length} clip(s) with ffmpeg…`, agentMode);

  try {
    await exec(
      `${ffmpeg} -y -f concat -safe 0 -i "${concatFile}" -c copy "${combinedPath}"`,
    );
  } catch (err) {
    const msg = `ffmpeg failed: ${(err as Error).message}. Ensure ffmpeg is in PATH or set FILMBUFF_FFMPEG_PATH.`;
    if (agentMode) { agentError(EXIT.GENERAL_ERROR, msg); } else { console.error(`✗ ${msg}`); }
    process.exit(1);
  }

  // ── Write index.html ──────────────────────────────────────────────────────
  const indexPath = path.join(outputDir, 'index.html');
  await fsPromises.writeFile(indexPath, buildIndexHtml(clipItems), 'utf-8');

  // ── Write project.zip ─────────────────────────────────────────────────────
  const zipPath = path.join(outputDir, 'project.zip');
  // Use built-in archiver if available; otherwise shell out to zip
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const archiver = require('archiver') as { (format: string, opts?: object): { on: (e: string, cb: (err?: Error) => void) => void; pipe: (d: NodeJS.WritableStream) => void; file: (p: string, n: object) => void; finalize: () => void } };
    const output   = fs.createWriteStream(zipPath);
    const archive  = archiver('zip', { zlib: { level: 9 } });
    const instance = archiver('zip', { zlib: { level: 9 } });
    await new Promise<void>((resolve, reject) => {
      instance.on('error', (err?: Error) => reject(err));
      output.on('close', () => resolve());
      instance.pipe(output);
      eligible.forEach(({ record }) => {
        const absClip = path.resolve(projectPath, record!.clip_path!);
        instance.file(absClip, { name: `clips/${path.basename(absClip)}` });
      });
      instance.file(indexPath, { name: 'index.html' });
      instance.file(combinedPath, { name: 'combined.mp4' });
      for (const f of fs.readdirSync(projectPath).filter((fn: string) => fn.endsWith('.md') || fn.endsWith('.fountain') || fn.endsWith('.jsonl'))) {
        instance.file(path.join(projectPath, f), { name: f });
      }
      instance.finalize();
    });
  } catch {
    // archiver not available — skip zip (non-fatal)
    humanLog('⚠  archiver package not available; skipping project.zip', agentMode);
  }

  humanLog(`✓ Compile complete.`, agentMode);
  humanLog(`  combined.mp4 → ${combinedPath}`, agentMode);
  humanLog(`  index.html   → ${indexPath}`, agentMode);
  humanLog(`  project.zip  → ${zipPath}`, agentMode);

  if (agentMode) {
    agentSuccess({
      clips_compiled: eligible.length,
      combined_mp4:   combinedPath,
      index_html:     indexPath,
      project_zip:    zipPath,
      output_dir:     outputDir,
    });
  }

  process.exit(EXIT.SUCCESS);
}
