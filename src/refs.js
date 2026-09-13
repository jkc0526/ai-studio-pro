/**
 * 上游素材引用表的纯函数实现（画布与节点组件共用，避免两处漂移）。
 *
 * 编号规则（前后端必须一致）：连线传进来的图片/视频按顺序编号 图片1..n / 视频1..n。
 * 节点的「参考」行与 @引用 都基于这张表；写进 node.data.mediaRefs 后，
 * 后端 server/engine.js 的 mentionKeys / pickRefUrl 按同名 key 解析。
 */
export function buildRefs(nodeId, nodes = [], edges = []) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const ups = edges
    .filter((e) => e.target === nodeId && map.has(e.source))
    .map((e) => map.get(e.source));
  const refs = [];
  let imgN = 0; let vidN = 0;
  for (const up of ups) {
    const d = up.data || {};
    const isUpload = up.type === 'uploadNode' || up.type === 'assetNode';
    const gridImg = Array.isArray(d.images) && d.images.length
      ? d.images[Number.isInteger(d.pickedIndex) ? d.pickedIndex : d.images.length - 1] : null;
    const vid = d.videoUrl || (isUpload && d.kind === 'video' ? d.url : null);
    const img = d.imageUrl || gridImg || (isUpload && d.kind !== 'video' ? d.url : null);
    if (vid) refs.push({ key: `视频${++vidN}`, type: 'video', url: vid, from: up.type, label: d.label || '' });
    else if (img) refs.push({ key: `图片${++imgN}`, type: 'image', url: img, from: up.type, label: d.label || '' });
  }
  return refs;
}
