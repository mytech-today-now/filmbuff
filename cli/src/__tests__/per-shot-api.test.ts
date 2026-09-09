import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

jest.mock('../lib/pika-video-client', () => ({
  generatePikaVideoForCli: jest.fn(),
}));

jest.mock('../utils/filmbuff-ai-client', () => ({
  getFilmbuffAiClient: jest.fn(),
}));

import { generatePikaVideoForCli } from '../lib/pika-video-client';
import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client';
import { generateSingleShot } from '../lib/per-shot-api';

const mockPika = generatePikaVideoForCli as jest.MockedFunction<typeof generatePikaVideoForCli>;
const mockGetAiClient = getFilmbuffAiClient as jest.MockedFunction<typeof getFilmbuffAiClient>;

describe('per-shot API bridge', () => {
  let tempDir: string;

  beforeEach(async () => {
    delete process.env['FILMBUFF_MOCK_PROVIDER'];
    mockPika.mockReset();
    mockGetAiClient.mockReset();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filmbuff-per-shot-'));
  });

  afterEach(async () => {
    delete process.env['FILMBUFF_MOCK_PROVIDER'];
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses the real Pika adapter outside mock mode and writes the returned clip', async () => {
    mockPika.mockResolvedValue({
      requestId: 'pika-job-001',
      contentUrl: 'data:video/mp4;base64,AAEC',
    });

    const outputPath = path.join(tempDir, 'nested', 's001.mp4');
    const result = await generateSingleShot({
      shot: {
        shot_id: 's001',
        subject: 'A cyclist',
        duration_seconds: 8,
        providerOptions: { resolution: '720p' },
      },
      provider: 'pika',
      model: 'pika/pika-2.5/text-to-video',
      providerOptions: { seed: 7 },
      extraNotes: 'Keep the camera low.',
      outputPath,
      timeoutMs: 1_000,
      agentToken: 'must-not-leak',
    });

    expect(result).toEqual(expect.objectContaining({
      jobId: 'pika-job-001',
      status: 'complete',
      clipPath: outputPath,
      durationSeconds: 8,
      creditsCharged: 4,
    }));
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect(await fs.readFile(outputPath)).toEqual(Buffer.from([0, 1, 2]));
    expect(mockPika).toHaveBeenCalledWith(
      expect.stringContaining('Additional guidance: Keep the camera low.'),
      'pika/pika-2.5/text-to-video',
      { resolution: '720p', seed: 7 },
      { timeoutMs: 1_000 },
    );
  });

  it('supports the legacy pika-2 provider name without using the mock branch', async () => {
    mockPika.mockResolvedValue({
      requestId: 'pika-job-legacy',
      contentUrl: 'data:video/mp4;base64,BAU=',
    });

    const outputPath = path.join(tempDir, 's002.mp4');
    const result = await generateSingleShot({
      shot: { shot_id: 's002' },
      provider: 'pika-2',
      outputPath,
    });

    expect(result.status).toBe('complete');
    expect(mockPika).toHaveBeenCalledWith(
      expect.any(String),
      'pika/pika-2.5/text-to-video',
      {},
      { timeoutMs: undefined },
    );
  });

  it('uses the existing ai-powered client for other configured providers', async () => {
    const client = {
      generateVideo: jest.fn().mockResolvedValue({
        data: 'Bgc=',
        durationSeconds: 6,
      }),
    };
    mockGetAiClient.mockResolvedValue(client as never);

    const outputPath = path.join(tempDir, 's003.mp4');
    const result = await generateSingleShot({
      shot: { shot_id: 's003', scene: 'INT. LAB', subject: 'A scientist' },
      provider: 'lumaai',
      model: 'ray-2',
      providerOptions: { quality: 'high' },
      outputPath,
    });

    expect(result.status).toBe('complete');
    expect(result.clipPath).toBe(outputPath);
    expect(await fs.readFile(outputPath)).toEqual(Buffer.from([6, 7]));
    expect(mockGetAiClient).toHaveBeenCalledWith('video-generator', {
      provider: 'lumaai',
      model: 'ray-2',
    });
    expect(client.generateVideo).toHaveBeenCalledWith(
      expect.stringContaining('Subject: A scientist'),
      expect.objectContaining({ providerOptions: { quality: 'high' } }),
    );
  });

  it('propagates a provider failure instead of the old unconditional bridge error', async () => {
    mockPika.mockRejectedValue(new Error('Pika API unavailable'));

    await expect(generateSingleShot({
      shot: { shot_id: 's004', subject: 'A train' },
      provider: 'pika',
      outputPath: path.join(tempDir, 's004.mp4'),
    })).rejects.toThrow('Pika API unavailable');

    expect(mockPika).toHaveBeenCalledTimes(1);
    expect(mockGetAiClient).not.toHaveBeenCalled();
  });

  it('rejects unsupported provider output instead of writing a corrupt clip', async () => {
    const client = {
      generateVideo: jest.fn().mockResolvedValue({ data: 'not-a-video-url' }),
    };
    mockGetAiClient.mockResolvedValue(client as never);

    await expect(generateSingleShot({
      shot: { shot_id: 's005' },
      provider: 'lumaai',
      outputPath: path.join(tempDir, 's005.mp4'),
    })).rejects.toThrow('unsupported video data format');
  });
});
