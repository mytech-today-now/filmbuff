/**
 * ai-powered/src/__tests__/single-shot.test.ts
 *
 * Unit tests for WS-1: Per-Shot API
 * Tests: UT-API-01 through UT-API-10, UT-PROMPT-01 through UT-PROMPT-05,
 *        UT-CRED-01 through UT-CRED-04
 *
 * Spec: openspec/changes/filmb-ai-p/specs/ai-powered-integration/spec.md
 * Beads: bd-5fde (Phase 2 — WS-1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildShotPrompt } from '../prompt-builder.js';
import { extractCreditsCharged, pollShotJob } from '../poll-job.js';
import { generateSingleShot, submitSingleShot } from '../single-shot.js';
import {
  PROVIDER_DEFAULT_CREDITS,
  PROVIDER_POLL_INTERVAL_MS,
  type ShotListEntry,
  type SingleShotOptions,
} from '../types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FULL_SHOT: ShotListEntry = {
  shot_id: 's001',
  scene: 'EXT. ROOFTOP - NIGHT',
  shot_type: 'Wide',
  camera: 'Eye level',
  movement: 'Static',
  subject: 'Protagonist silhouette',
  duration_seconds: 8,
  mood: 'Tense, cinematic',
  dialogue: 'I will not let them win.',
  sfx: 'Wind, distant sirens',
  notes: 'Hold on the city skyline.',
};

const MINIMAL_SHOT: ShotListEntry = {
  shot_id: 's002',
};

// ---------------------------------------------------------------------------
// UT-PROMPT-01 through UT-PROMPT-05 — buildShotPrompt()
// ---------------------------------------------------------------------------

describe('buildShotPrompt()', () => {
  it('[UT-PROMPT-01] includes all fields when fully populated', () => {
    const prompt = buildShotPrompt(FULL_SHOT);
    expect(prompt).toContain('Scene: EXT. ROOFTOP - NIGHT');
    expect(prompt).toContain('Shot type: Wide');
    expect(prompt).toContain('Camera angle: Eye level');
    expect(prompt).toContain('Camera movement: Static');
    expect(prompt).toContain('Subject: Protagonist silhouette');
    expect(prompt).toContain('Duration: 8 seconds');
    expect(prompt).toContain('Mood/tone: Tense, cinematic');
    expect(prompt).toContain('Dialogue: "I will not let them win."');
    expect(prompt).toContain('Sound design reference: Wind, distant sirens');
    expect(prompt).toContain('Director notes: Hold on the city skyline.');
  });

  it('[UT-PROMPT-02] omits absent optional fields (no empty lines)', () => {
    const prompt = buildShotPrompt(MINIMAL_SHOT);
    expect(prompt).not.toContain('Scene:');
    expect(prompt).not.toContain('Shot type:');
    expect(prompt).not.toContain('Duration:');
    expect(prompt).not.toContain('Sound design reference:');
    expect(prompt).not.toContain('Director notes:');
    // Dialogue absent → "(no dialogue)" placeholder
    expect(prompt).toContain('(no dialogue)');
  });

  it('[UT-PROMPT-03] appends extraNotes to Director notes line', () => {
    const prompt = buildShotPrompt(FULL_SHOT, 'Add more contrast.');
    expect(prompt).toContain('Director notes: Hold on the city skyline.. Additional guidance: Add more contrast.');
  });

  it('[UT-PROMPT-04] extraNotes without base notes emits Director notes with guidance only', () => {
    const shot = { ...MINIMAL_SHOT, shot_id: 's003' };
    const prompt = buildShotPrompt(shot, 'Extra note here.');
    expect(prompt).toContain('Director notes: Additional guidance: Extra note here.');
  });

  it('[UT-PROMPT-05] agentToken does NOT appear in prompt string', () => {
    const prompt = buildShotPrompt(FULL_SHOT, 'some notes');
    // agentToken is not a parameter of buildShotPrompt — verify string contains no token artifacts
    expect(prompt).not.toMatch(/Bearer/i);
    expect(prompt).not.toMatch(/agentToken/i);
  });
});

// ---------------------------------------------------------------------------
// UT-CRED-01 through UT-CRED-04 — extractCreditsCharged()
// ---------------------------------------------------------------------------

describe('extractCreditsCharged()', () => {
  it('[UT-CRED-01] extracts credits_charged from provider response', () => {
    expect(extractCreditsCharged({ credits_charged: 7 }, 'runway-gen3')).toBe(7);
  });

  it('[UT-CRED-02] falls back to static default when field absent', () => {
    expect(extractCreditsCharged({}, 'runway-gen3')).toBe(PROVIDER_DEFAULT_CREDITS['runway-gen3']);
    expect(extractCreditsCharged({}, 'pika-2')).toBe(PROVIDER_DEFAULT_CREDITS['pika-2']);
    expect(extractCreditsCharged({}, 'kling-1.6')).toBe(PROVIDER_DEFAULT_CREDITS['kling-1.6']);
  });

  it('[UT-CRED-03] uses "credits" field as alternative key', () => {
    expect(extractCreditsCharged({ credits: 4 }, 'pika-2')).toBe(4);
  });

  it('[UT-CRED-04] returns 0 for unknown provider with no response field', () => {
    expect(extractCreditsCharged({}, 'unknown-provider')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// UT-API-01 through UT-API-10 — pollShotJob() and single-shot functions
// ---------------------------------------------------------------------------

describe('pollShotJob()', () => {
  it('[UT-API-01] returns complete result when job succeeds on first poll', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      done: true, success: true,
      clipUrl: 'https://cdn.example.com/clip.mp4',
      durationSeconds: 8, resolution: '1920x1080',
      rawResponse: { credits_charged: 5 },
    });
    // Inject a no-op downloader so no real HTTP request is made
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const result = await pollShotJob('job-001', 'runway-gen3', '/tmp/s001.mp4', 30_000, undefined, mockFetch, mockDownload);
    expect(result.status).toBe('complete');
    expect(result.jobId).toBe('job-001');
    expect(result.creditsCharged).toBe(5);
    expect(mockDownload).toHaveBeenCalledWith('https://cdn.example.com/clip.mp4', '/tmp/s001.mp4');
  });

  it('[UT-API-02] returns failed with api_timeout when deadline exceeded', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ done: false, success: false, rawResponse: {} });
    const result = await pollShotJob('job-002', 'runway-gen3', '/tmp/s002.mp4', 50, undefined, mockFetch);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('api_timeout');
  });

  it('[UT-API-03] returns failed when provider signals failure', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      done: true, success: false,
      errorMessage: 'content_policy_violation',
      rawResponse: {},
    });
    const result = await pollShotJob('job-003', 'pika-2', '/tmp/s003.mp4', 30_000, undefined, mockFetch);
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('content_policy_violation');
  });

  it('[UT-API-04] uses provider-specific polling interval (kling-1.6 = 10s)', () => {
    expect(PROVIDER_POLL_INTERVAL_MS['kling-1.6']).toBe(10_000);
    expect(PROVIDER_POLL_INTERVAL_MS['runway-gen3']).toBe(5_000);
    expect(PROVIDER_POLL_INTERVAL_MS['pika-2']).toBe(5_000);
  });

  it('[UT-API-05] applies static credit fallback for kling-1.6', () => {
    expect(PROVIDER_DEFAULT_CREDITS['kling-1.6']).toBe(6);
  });
});

describe('submitSingleShot()', () => {
  it('[UT-API-06] returns jobId from provider without polling', async () => {
    const mockSubmit = vi.fn().mockResolvedValueOnce({ jobId: 'rw_job_abc123' });
    const opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'> = {
      shot: FULL_SHOT, provider: 'runway-gen3',
    };
    const result = await submitSingleShot(opts, mockSubmit);
    expect(result.jobId).toBe('rw_job_abc123');
    expect(mockSubmit).toHaveBeenCalledOnce();
  });

  it('[UT-API-07] agentToken passed to submit but NOT in returned object', async () => {
    const mockSubmit = vi.fn().mockResolvedValueOnce({ jobId: 'rw_job_xyz' });
    const opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'> = {
      shot: FULL_SHOT, provider: 'runway-gen3', agentToken: 'secret-token',
    };
    const result = await submitSingleShot(opts, mockSubmit);
    expect(result).not.toHaveProperty('agentToken');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('[UT-API-08] buildShotPrompt called with extraNotes', async () => {
    const mockSubmit = vi.fn().mockResolvedValueOnce({ jobId: 'job-008' });
    const opts: Omit<SingleShotOptions, 'outputPath' | 'timeoutMs'> = {
      shot: FULL_SHOT, provider: 'runway-gen3', extraNotes: 'Add lens flare.',
    };
    await submitSingleShot(opts, mockSubmit);
    const [prompt] = mockSubmit.mock.calls[0] as [string, ...unknown[]];
    expect(prompt).toContain('Add lens flare.');
  });
});

describe('generateSingleShot()', () => {
  it('[UT-API-09] composes submit + poll and returns complete result', async () => {
    const mockSubmit = vi.fn().mockResolvedValueOnce({ jobId: 'job-009' });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      done: true, success: true,
      clipUrl: 'https://cdn.example.com/009.mp4',
      rawResponse: { credits_charged: 4 },
    });
    // Inject a no-op downloader so no real HTTP request is made
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const opts: SingleShotOptions = {
      shot: FULL_SHOT, provider: 'pika-2',
      outputPath: '/tmp/s001.mp4', timeoutMs: 30_000,
    };
    const result = await generateSingleShot(opts, mockSubmit, mockFetch, mockDownload);
    expect(result.status).toBe('complete');
    expect(result.jobId).toBe('job-009');
    expect(result.creditsCharged).toBe(4);
    expect(mockDownload).toHaveBeenCalledOnce();
  });

  it('[UT-API-10] agentToken NOT included in SingleShotResult', async () => {
    const mockSubmit = vi.fn().mockResolvedValueOnce({ jobId: 'job-010' });
    const mockFetch = vi.fn().mockResolvedValueOnce({
      done: true, success: false, errorMessage: 'quota_exceeded', rawResponse: {},
    });
    const opts: SingleShotOptions = {
      shot: FULL_SHOT, provider: 'runway-gen3',
      outputPath: '/tmp/s001.mp4', timeoutMs: 30_000,
      agentToken: 'super-secret',
    };
    const result = await generateSingleShot(opts, mockSubmit, mockFetch);
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(result).not.toHaveProperty('agentToken');
  });
});
