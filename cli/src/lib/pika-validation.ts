import type { VideoModelCapability } from './provider-capabilities.js';

export function validatePikaReferenceCount(model: VideoModelCapability, count: number): string[] {
  const errors: string[] = [];
  if (model.minReferenceImages !== undefined && count < model.minReferenceImages) {
    errors.push(`Pika model "${model.id}" requires at least ${model.minReferenceImages} reference images; received ${count}.`);
  }
  if (model.maxReferenceImages !== undefined && count > model.maxReferenceImages) {
    errors.push(`Pika model "${model.id}" accepts at most ${model.maxReferenceImages} reference images; received ${count}.`);
  }
  return errors;
}

export function validatePikaOptions(
  model: VideoModelCapability,
  options: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  const supported = new Set(model.supportedOptions);
  for (const key of Object.keys(options).sort()) {
    if (!supported.has(key)) errors.push(`Pika model "${model.id}" does not support option "${key}".`);
  }
  for (const required of model.requiredOptions) {
    if (!(required in options)) errors.push(`Pika model "${model.id}" requires option "${required}".`);
  }
  for (const field of model.supportedOptions) {
    if (!(field in options)) continue;
    const value = options[field];
    if (field === 'image' || field === 'video' || field === 'modify_region_mask') {
      if (typeof value !== 'string' || !/^https:\/\/[^\s]+$/i.test(value)) {
        errors.push(`Pika model "${model.id}" option "${field}" must be an absolute HTTPS URL.`);
      }
    }
    if (field === 'images') {
      if (!Array.isArray(value) || value.some(url => typeof url !== 'string' || !/^https:\/\/[^\s]+$/i.test(url))) {
        errors.push(`Pika model "${model.id}" option "images" must be an array of absolute HTTPS URLs.`);
      } else {
        errors.push(...validatePikaReferenceCount(model, value.length));
      }
    }
    if (field === 'prompt' || field === 'negative_prompt' || field === 'modify_region_roi') {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`Pika model "${model.id}" option "${field}" must be a non-empty string.`);
      }
    }
    const allowed = model.enumOptions?.[field];
    if (allowed && !allowed.includes(value as never)) {
      errors.push(`Pika model "${model.id}" option "${field}" must be one of ${allowed.join(', ')}.`);
    }
    const constraint = model.numericConstraints?.[field];
    if (constraint) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`Pika model "${model.id}" option "${field}" must be a finite number.`);
      } else if (constraint.integer && !Number.isInteger(value)) {
        errors.push(`Pika model "${model.id}" option "${field}" must be an integer.`);
      } else if (constraint.min !== undefined && value < constraint.min) {
        errors.push(`Pika model "${model.id}" option "${field}" must be at least ${constraint.min}.`);
      } else if (constraint.max !== undefined && value > constraint.max) {
        errors.push(`Pika model "${model.id}" option "${field}" must be at most ${constraint.max}.`);
      }
    }
  }
  if (model.id === 'pika/pikaswaps/video-to-video') {
    const hasRoi = 'modify_region_roi' in options;
    const hasMask = 'modify_region_mask' in options;
    if (!hasRoi && !hasMask) errors.push(`Pika model "${model.id}" requires either "modify_region_roi" or "modify_region_mask".`);
    if (hasRoi && hasMask) errors.push(`Pika model "${model.id}" accepts only one of "modify_region_roi" or "modify_region_mask".`);
  }
  return errors;
}
