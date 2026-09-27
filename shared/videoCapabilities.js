const DEFAULT_VIDEO_DURATION_RANGE = Object.freeze({ min: 4, max: 12, source: 'default' });

function numericRange(value) {
  let min;
  let max;
  if (Array.isArray(value) && value.length >= 2) {
    const values = value.map(Number).filter(Number.isFinite);
    min = Math.min(...values);
    max = Math.max(...values);
  } else if (value && typeof value === 'object') {
    min = value.min ?? value.minDuration ?? value.min_duration ?? value.minSeconds ?? value.min_seconds ?? value.minimum;
    max = value.max ?? value.maxDuration ?? value.max_duration ?? value.maxSeconds ?? value.max_seconds ?? value.maximum;
  }
  min = Number(min);
  max = Number(max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min || max > 120) return null;
  return { min: Math.ceil(min), max: Math.floor(max) };
}

export function readVideoDurationCapability(model) {
  if (!model || typeof model !== 'object') return null;
  const candidates = [
    model.video_duration_range,
    model.videoDurationRange,
    model.duration_range,
    model.durationRange,
    model.duration,
    model.duration_seconds,
    model.supported_durations,
    model.supportedDurations,
    model.video?.durations,
    model.video?.duration,
    model.capabilities?.video?.duration,
    model.capabilities?.video?.duration_seconds,
    model.capabilities?.video?.duration_range,
    model.capabilities?.video?.durationRange,
    model.capabilities?.duration,
    model.capabilities?.duration_range,
    model.capabilities?.durationRange,
    model.capabilities?.video?.min_duration !== undefined || model.capabilities?.video?.max_duration !== undefined
      ? model.capabilities.video : null,
    model.video?.duration_range,
  ];
  for (const candidate of candidates) {
    const range = numericRange(candidate);
    if (range) return range;
  }
  return null;
}

function priceUnitLabel(unit, fallback = '次') {
  const value = String(unit || '').trim();
  if (!value) return fallback;
  if (/token|prompt|completion|input|output/i.test(value)) return null;
  if (/second|seconds|sec|^s$|秒/i.test(value)) return '秒';
  if (/minute|minutes|min|分钟/i.test(value)) return '分钟';
  if (/generation|request|call|task|video|clip|次|条/i.test(value)) return '次';
  return value.replace(/^per[_\s-]*/i, '');
}

function currencySymbol(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (/^(CNY|RMB|CN¥|¥|￥)$/.test(currency)) return '¥';
  if (/^(USD|US\$|\$)$/.test(currency)) return '$';
  if (/^(EUR|€)$/.test(currency)) return '€';
  if (/^(JPY|円)$/.test(currency)) return '¥';
  return value ? `${value} ` : '';
}

function priceRecord(value, metadata, impliedUnit) {
  if (value == null) return null;
  const item = value && typeof value === 'object' ? value : {};
  const unit = item.unit ?? item.billing_unit ?? item.billingUnit ?? item.price_unit
    ?? metadata.price_unit ?? metadata.priceUnit ?? impliedUnit ?? metadata.billing_unit ?? metadata.unit;
  const normalizedUnit = priceUnitLabel(unit, impliedUnit || '次');
  if (!normalizedUnit) return null;

  const currency = item.currency ?? item.price_currency ?? metadata.currency ?? metadata.price_currency;
  let amount = item.amount ?? item.value ?? item.price ?? value;
  let embeddedCurrency = '';
  let embeddedUnit = '';
  if (typeof amount === 'string') {
    const match = amount.trim().match(/^(¥|￥|\$|€|(?:CNY|RMB|USD|EUR|JPY)\s*)?\s*([\d,]+(?:\.\d+)?)\s*(?:元)?(?:\s*\/\s*(.+))?$/i);
    if (!match) return null;
    embeddedCurrency = match[1] || '';
    amount = match[2].replace(/,/g, '');
    embeddedUnit = match[3] || '';
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) return null;

  const finalUnit = priceUnitLabel(embeddedUnit || unit, impliedUnit || normalizedUnit);
  if (!finalUnit) return null;
  const amountLabel = String(Number(numericAmount.toFixed(6)));
  const symbol = currencySymbol(currency || embeddedCurrency);
  return `${symbol}${amountLabel}/${finalUnit}`;
}

/** Reads an explicit per-video or per-generation price from an upstream /models record. */
export function formatVideoModelPrice(model) {
  if (!model || typeof model !== 'object') return null;
  const pricing = model.pricing && typeof model.pricing === 'object' ? model.pricing : {};
  const videoPricing = model.video?.pricing && typeof model.video.pricing === 'object'
    ? model.video.pricing : (pricing.video && typeof pricing.video === 'object' ? pricing.video : {});
  const metadata = { ...pricing, ...model, ...videoPricing };
  const candidates = [
    [model.price_per_video ?? model.pricePerVideo ?? model.video_price ?? model.videoPrice, '次'],
    [model.price_per_generation ?? model.pricePerGeneration ?? model.generation_price ?? model.generationPrice, '次'],
    [model.price_per_request ?? model.pricePerRequest ?? model.price_per_call ?? model.pricePerCall, '次'],
    [model.price_per_second ?? model.pricePerSecond ?? model.video?.price_per_second, '秒'],
    [videoPricing.per_video ?? videoPricing.perVideo ?? videoPricing.per_generation ?? videoPricing.perGeneration
      ?? videoPricing.per_request ?? videoPricing.perRequest ?? videoPricing.per_call ?? videoPricing.perCall, '次'],
    [videoPricing.per_second ?? videoPricing.perSecond, '秒'],
    [videoPricing.price ?? model.video?.price, '次'],
    [model.unit_price ?? model.unitPrice ?? model.price, null],
  ];
  for (const [value, impliedUnit] of candidates) {
    const formatted = priceRecord(value, metadata, impliedUnit);
    if (formatted) return formatted;
  }
  return null;
}

export function getVideoDurationRange(modelId, capability) {
  const provided = numericRange(capability) || readVideoDurationCapability(capability);
  if (provided) return { ...provided, source: 'provider' };

  const model = String(modelId || '').toLowerCase();
  if (/seedance[\s._-]*2[\s._-]*5/.test(model)) return { min: 4, max: 30, source: 'model' };
  if (/seedance[\s._-]*2[\s._-]*0/.test(model)) return { min: 4, max: 15, source: 'model' };
  return { ...DEFAULT_VIDEO_DURATION_RANGE };
}

export function getVideoDurationOptions(range) {
  const bounds = numericRange(range) || DEFAULT_VIDEO_DURATION_RANGE;
  return Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => bounds.min + index);
}

export function clampVideoDuration(value, range, fallback = 5) {
  const bounds = numericRange(range) || DEFAULT_VIDEO_DURATION_RANGE;
  const requested = Number(value);
  const fallbackValue = Number(fallback);
  const safeFallback = Number.isFinite(fallbackValue) ? Math.round(fallbackValue) : 5;
  const seconds = Number.isFinite(requested) ? Math.round(requested) : safeFallback;
  return Math.min(bounds.max, Math.max(bounds.min, seconds));
}
