const NODE_PORTS = Object.freeze({
  textNode: { source: true },
  llmNode: { source: true, target: true },
  imageNode: { source: true, target: true },
  videoNode: { source: true, target: true },
  noteNode: {},
  uploadNode: { source: true },
  assetNode: { source: true },
  scriptNode: { source: true },
  audioNode: { source: true, target: true },
  gridNode: { source: true, target: true },
  composeNode: { source: true, target: true },
  directorNode: { source: true, target: true },
  batchUploadNode: { source: true },
});

export function getAutoConnectParams({ connection, nodeId, nodeType }) {
  if (!connection?.nodeId || !nodeId) return null;
  const ports = NODE_PORTS[nodeType] || {};

  if (connection.handleType === 'source' && ports.target) {
    return {
      source: connection.nodeId,
      sourceHandle: connection.handleId,
      target: nodeId,
    };
  }
  if (connection.handleType === 'target' && ports.source) {
    return {
      source: nodeId,
      target: connection.nodeId,
      targetHandle: connection.handleId,
    };
  }
  return null;
}
