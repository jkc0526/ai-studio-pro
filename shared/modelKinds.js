export function modelKind(id) {
  if (/video|wan|kling|seedance|sora|veo|hailuo|h3|runway|(?:^|[-_])gen[-_]?4|pika|pixverse|vidu|luma|ray[-_]?\d|cogvideo|hunyuan[-_]?(?:video|t2v|i2v)|ltx[-_]?(?:video|\d)|mochi|jimeng|dreamina|grok.*video|firefly.*video|qwen.*video|(?:^|[-_])(?:t2v|i2v|v2v)(?:$|[-_])/i.test(String(id || ''))) return 'video';
  if (/image|dall-?e|flux|seedream|midjourney|nano.?banana|stable-?diffusion|imagen|ideogram|recraft|qwen.*image|kolors|hidream|playground/i.test(String(id || ''))) return 'image';
  return 'text';
}
