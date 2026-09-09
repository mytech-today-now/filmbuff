/**
 * Canonical provider capability data shared by CLI, GUI state, validation,
 * and the public ai-powered adapter through the repository source export.
 */

export type VideoModelOperation = 'text-to-video' | 'image-to-video' | 'video-to-video';

export interface NumericConstraint {
  min?: number;
  max?: number;
  integer?: boolean;
  values?: readonly number[];
}

export interface VideoModelCapability {
  id: string;
  displayName: string;
  endpoint: string;
  operation: VideoModelOperation;
  requiredOptions: readonly string[];
  supportedOptions: readonly string[];
  enumOptions?: Readonly<Record<string, readonly (string | number)[]>>;
  numericConstraints?: Readonly<Record<string, NumericConstraint>>;
  minReferenceImages?: number;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
}

export interface SharedVideoProviderCapability {
  id: string;
  displayName: string;
  apiKeyEnvVar: string | null;
  baseUrl: string | null;
  defaultModel: string;
  videoSupport: boolean;
  maxI2VImages: number;
  models: readonly VideoModelCapability[];
}

export const PIKA_API_BASE_URL = 'https://api.dev.pika.art';
export const PIKA_PROVIDER_ID = 'pika';
export const PIKA_API_KEY_ENV_VAR = 'PIKA_API_KEY';

const RESOLUTIONS = ['720p', '1080p'] as const;
const FIVE_OR_TEN_SECONDS = [5, 10] as const;
export const PIKA_IMAGE_EFFECTS = [
  '90s Me', 'Action Me', 'Arcade Winner', 'Baby Me', 'Bald Me', 'Balloonify it',
  'CCTV Me', 'Cake-ify', 'Captain Me', 'Choco Me', 'Classy Me', 'Clown Fit',
  'Crazy in Love', 'Crumble', 'Crush', 'Cupid Strike', 'Decapitate', 'Deflate',
  'Dissolve', 'Doom Stroll', 'Eat a Rat', 'Epic Me', 'Everythings Bonsai',
  'Explode', 'Eye-pop', 'Eyes Zoom in', 'Fairytale Me', 'Goth Dream', 'Hazmat Fit',
  'Hearts Bouquet', 'Hero Me', 'Human Pet', 'Inflate', 'Jungle Me', 'Labubu Style',
  'Leprechaun Me', 'Levitate', 'Lo-Fi Me', 'Looong Hair', 'Love Bomb',
  'Magic Polaroid', 'Make it Real', 'Melt', 'Mona Me', 'Mrs Me', 'Museum Me',
  'Peel', 'Pick Me', 'Poke', 'Princess Me', 'Proposal', 'Puppy Me', 'Rose',
  'Royal Me', 'Squish', 'Ta-da', 'Tarot', 'Transform', 'Tear', 'VIP Me',
  'Warrior Me', 'Yarn Charm', 'Zen Me'
] as const;
export const PIKA_VIDEO_EFFECTS = [
  'Anime Cat', 'Cute Shroom', 'Duplicate it', 'Happy Asteroid', 'Its Alive',
  'Its Computer', 'Pink Hair', 'Swan Head', 'Wizard Cat'
] as const;

function model(
  id: string,
  displayName: string,
  operation: VideoModelOperation,
  requiredOptions: readonly string[],
  supportedOptions: readonly string[],
  extra: Omit<VideoModelCapability, 'id' | 'displayName' | 'endpoint' | 'operation' | 'requiredOptions' | 'supportedOptions'> = {}
): VideoModelCapability {
  return { id, displayName, endpoint: `/v1/media/${id}`, operation, requiredOptions, supportedOptions, ...extra };
}

export const PIKA_MODEL_CAPABILITIES: readonly VideoModelCapability[] = [
  model('pika/pika-2.5/text-to-video', 'Pika 2.5 Text to Video', 'text-to-video', ['prompt'],
    ['prompt', 'resolution', 'duration_s', 'negative_prompt', 'seed'], {
      enumOptions: { resolution: [...RESOLUTIONS], duration_s: [5] },
      numericConstraints: { seed: { integer: true } }, maxReferenceImages: 0
    }),
  model('pika/pika-2.5/image-to-video', 'Pika 2.5 Image to Video', 'image-to-video', ['image'],
    ['image', 'prompt', 'resolution', 'duration_s', 'negative_prompt', 'seed'], {
      enumOptions: { resolution: [...RESOLUTIONS], duration_s: [...FIVE_OR_TEN_SECONDS] },
      numericConstraints: { seed: { integer: true } }, minReferenceImages: 1, maxReferenceImages: 1
    }),
  model('pika/pikaframes/image-to-video', 'Pika Frames Keyframe', 'image-to-video', ['images'],
    ['images', 'prompt', 'resolution', 'transition_duration_s', 'negative_prompt', 'seed'], {
      enumOptions: { resolution: [...RESOLUTIONS] },
      numericConstraints: {
        transition_duration_s: { min: 1, max: 10, integer: true }, seed: { integer: true }
      }, minReferenceImages: 2, maxReferenceImages: 5
    }),
  model('pika/pikadditions/video-to-video', 'Pikadditions', 'video-to-video', ['video', 'prompt'],
    ['video', 'prompt', 'resolution', 'duration_s', 'negative_prompt', 'seed', 'image'], {
      enumOptions: { resolution: [...RESOLUTIONS], duration_s: [...FIVE_OR_TEN_SECONDS] },
      numericConstraints: { seed: { integer: true } }, maxReferenceImages: 1, maxReferenceVideos: 1
    }),
  model('pika/pikaswaps/video-to-video', 'Pikaswaps', 'video-to-video', ['video', 'prompt'],
    ['video', 'prompt', 'resolution', 'duration_s', 'negative_prompt', 'seed', 'modify_region_roi', 'modify_region_mask', 'image'], {
      enumOptions: { resolution: [...RESOLUTIONS], duration_s: [...FIVE_OR_TEN_SECONDS] },
      numericConstraints: { seed: { integer: true } }, maxReferenceImages: 1, maxReferenceVideos: 1
    }),
  model('pika/pikaffects/image-to-video', 'Pikaffects Image to Video', 'image-to-video', ['pikaffect', 'image'],
    ['pikaffect', 'image', 'seed'], {
      enumOptions: { pikaffect: [...PIKA_IMAGE_EFFECTS] }, numericConstraints: { seed: { integer: true } },
      minReferenceImages: 1, maxReferenceImages: 1
    }),
  model('pika/pikaffects/video-to-video', 'Pikaffects Video to Video', 'video-to-video', ['pikaffect', 'video'],
    ['pikaffect', 'video', 'seed'], {
      enumOptions: { pikaffect: [...PIKA_VIDEO_EFFECTS] }, numericConstraints: { seed: { integer: true } },
      maxReferenceVideos: 1
    })
];

export const PIKA_VIDEO_PROVIDER: SharedVideoProviderCapability = {
  id: PIKA_PROVIDER_ID,
  displayName: 'Pika AI',
  apiKeyEnvVar: PIKA_API_KEY_ENV_VAR,
  baseUrl: PIKA_API_BASE_URL,
  defaultModel: 'pika/pika-2.5/text-to-video',
  videoSupport: true,
  maxI2VImages: 5,
  models: PIKA_MODEL_CAPABILITIES
};

export const SHARED_VIDEO_PROVIDER_CAPABILITIES: readonly SharedVideoProviderCapability[] = [
  {
    id: 'lumaai',
    displayName: 'Luma AI',
    apiKeyEnvVar: 'LUMAAI_API_KEY',
    baseUrl: 'https://api.lumalabs.ai',
    defaultModel: 'ray-2',
    videoSupport: true,
    maxI2VImages: 2,
    models: [model('ray-2', 'Ray 2', 'text-to-video', ['prompt'], ['prompt']), model('ray-2-turbo', 'Ray 2 Turbo', 'text-to-video', ['prompt'], ['prompt'])]
  },
  {
    id: 'xai',
    displayName: 'xAI (Grok)',
    apiKeyEnvVar: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai',
    defaultModel: 'grok-2-vision',
    videoSupport: true,
    maxI2VImages: 1,
    models: [model('grok-2-vision', 'Grok 2 Vision', 'image-to-video', ['image'], ['image'])]
  },
  {
    id: 'venice',
    displayName: 'Venice AI',
    apiKeyEnvVar: 'VENICE_API_KEY',
    baseUrl: 'https://api.venice.ai',
    defaultModel: 'wan-2.5-preview-image-to-video',
    videoSupport: true,
    maxI2VImages: 1,
    models: [model('wan-2.5-preview-image-to-video', 'Wan 2.5 Preview', 'image-to-video', ['image'], ['image'])]
  },
  {
    id: 'mock',
    displayName: 'Mock (CI/local testing)',
    apiKeyEnvVar: null,
    baseUrl: null,
    defaultModel: 'mock-v1',
    videoSupport: true,
    maxI2VImages: -1,
    models: [model('mock-v1', 'Mock Video', 'text-to-video', ['prompt'], ['prompt'])]
  },
  PIKA_VIDEO_PROVIDER
];

export function getSharedVideoProvider(providerId: string): SharedVideoProviderCapability | undefined {
  return SHARED_VIDEO_PROVIDER_CAPABILITIES.find(provider => provider.id === providerId);
}

export function getSharedVideoModel(providerId: string, modelId: string): VideoModelCapability | undefined {
  return getSharedVideoProvider(providerId)?.models.find(modelEntry => modelEntry.id === modelId);
}
