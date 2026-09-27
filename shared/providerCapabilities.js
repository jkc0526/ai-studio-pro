import { modelKind } from './modelKinds.js';

const TEXT_ONLY_PROVIDER = /deepseek|api\.deepseek\.com/i;

export function providerSupportsMedia(provider, kind) {
  if (kind !== 'image' && kind !== 'video') return false;
  const models = Array.isArray(provider?.models) ? provider.models : [];
  if (models.length) {
    return models.some((model) => {
      const id = typeof model === 'string' ? model : (model?.id || model?.name || '');
      return modelKind(id) === kind;
    });
  }

  const identity = [provider?.name, provider?.base_url, provider?.protocol].filter(Boolean).join(' ');
  return !TEXT_ONLY_PROVIDER.test(identity);
}
