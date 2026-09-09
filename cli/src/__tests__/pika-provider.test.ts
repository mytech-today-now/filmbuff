import {
  BUILTIN_DEFAULT_CONFIG,
  resolveProvider,
  fetchProviderCapabilities
} from '../lib/filmbuff-config.js';
import { serializeBatch, assertApiKeyAbsent } from '../lib/batch-serializer.js';
import { validateBatchPayload } from '../lib/pre-export-validator.js';
import { validatePikaOptions, validatePikaReferenceCount } from '../lib/pika-validation.js';
import { getVideoProviderChoices, DEFAULT_PROVIDER_PANEL_STATE, selectVideoProviderModel } from '../gui/state/provider-state.js';
import { getSharedVideoProvider } from '../lib/provider-capabilities.js';

const PIKA_KEYFRAME = 'pika/pikaframes/image-to-video';

describe('Pika provider integration', () => {
  test('uses one shared model catalog for config, capabilities, and GUI choices', async () => {
    const shared = getSharedVideoProvider('pika');
    expect(shared?.apiKeyEnvVar).toBe('PIKA_API_KEY');
    expect(shared?.models.map(model => model.id)).toHaveLength(7);
    expect(BUILTIN_DEFAULT_CONFIG.videoProviders.find(provider => provider.id === 'pika')?.supportedModels)
      .toEqual(shared?.models.map(model => model.id));

    const capabilities = await fetchProviderCapabilities('https://invalid.example', BUILTIN_DEFAULT_CONFIG, { offline: true });
    expect(capabilities.get('pika')?.models).toEqual(shared?.models.map(model => model.id));
    expect(getVideoProviderChoices().find(provider => provider.id === 'pika')?.models.map(model => model.id))
      .toEqual(shared?.models.map(model => model.id));
  });

  test('selecting Pika without a model uses the current Pika default', () => {
    const resolved = resolveProvider(BUILTIN_DEFAULT_CONFIG, { provider: 'pika' });
    expect(resolved.model).toBe('pika/pika-2.5/text-to-video');
  });

  test.each([
    [0, true],
    [1, true],
    [2, false],
    [5, false],
    [6, true]
  ])('enforces keyframe image count at %i', (count, invalid) => {
    expect(validatePikaReferenceCount(
      getSharedVideoProvider('pika')!.models.find(model => model.id === PIKA_KEYFRAME)!,
      count
    ).length > 0).toBe(invalid);
  });

  test('rejects unsupported Pika options and invalid media values', () => {
    const model = getSharedVideoProvider('pika')!.models.find(entry => entry.id === 'pika/pika-2.5/image-to-video')!;
    expect(validatePikaOptions(model, {
      image: 'not-a-url',
      unsupported_option: true
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('does not support option "unsupported_option"'),
      expect.stringContaining('must be an absolute HTTPS URL')
    ]));
  });

  test('round trips Pika provider options without credentials', () => {
    const payload = serializeBatch([{
      id: 's001',
      heading: 'EXT. ROOFTOP - NIGHT',
      prompt: 'A city skyline under rain',
      controls: { duration: 5 },
      provider: 'pika',
      model: 'pika/pika-2.5/text-to-video',
      providerOptions: { resolution: '1080p', duration_s: 5, seed: 42 }
    }], 'pika', 'pika/pika-2.5/text-to-video');
    expect(payload.items[0].providerOptions).toEqual({ resolution: '1080p', duration_s: 5, seed: 42 });
    expect(assertApiKeyAbsent(payload)).toBe(true);
  });

  test('Pika option errors are blocking during batch validation', async () => {
    const result = await validateBatchPayload({
      provider: 'pika',
      model: 'pika/pika-2.5/text-to-video',
      items: [{
        name: 's001',
        provider: 'pika',
        model: 'pika/pika-2.5/text-to-video',
        providerOptions: { unsupported_option: true }
      }]
    }, BUILTIN_DEFAULT_CONFIG, { offline: true });
    expect(result.errors.some(error => error.rule === 'V-7')).toBe(true);
  });

  test('GUI state stores the selected Pika model', () => {
    const next = selectVideoProviderModel(DEFAULT_PROVIDER_PANEL_STATE, 'pika/pikaframes/image-to-video');
    expect(next.selectedModelId).toBe(PIKA_KEYFRAME);
  });
});
