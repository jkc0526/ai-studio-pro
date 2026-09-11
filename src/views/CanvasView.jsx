import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, MarkerType,
  useNodesState, useEdgesState, addEdge, applyNodeChanges, applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import { api } from '../api.js';
import { CanvasCtx } from '../context.js';
import TextNode from '../nodes/TextNode.jsx';
import LlmNode from '../nodes/LlmNode.jsx';
import ImageNode from '../nodes/ImageNode.jsx';
import VideoNode from '../nodes/VideoNode.jsx';
import NoteNode from '../nodes/NoteNode.jsx';
import UploadNode from '../nodes/UploadNode.jsx';
import AssetNode from '../nodes/AssetNode.jsx';
import ScriptNode from '../nodes/ScriptNode.jsx';
import AudioNode from '../nodes/AudioNode.jsx';
import GridNode from '../nodes/GridNode.jsx';
import SnippetsPanel from '../components/SnippetsPanel.jsx';
import NodePalette from '../components/NodePalette.jsx';

const nodeTypes = {
  textNode: TextNode, llmNode: LlmNode, imageNode: ImageNode, noteNode: NoteNode,
  videoNode: VideoNode, uploadNode: UploadNode, assetNode: AssetNode,
  scriptNode: ScriptNode, audioNode: AudioNode, gridNode: GridNode,
};

const SAMPLE = {
  text: '"分手吧！"\n\n接到电话的陈默，苦涩地笑着。他理解平绮绮的选择，毕竟在这个时代，有多少人愿意陪着另一半过苦日子呢？\n\n"明白了。"挂断电话，他握紧了兜里那张皱巴巴的录取通知书。',
  llm: '你是资深 AI 漫剧策划，请把下面这段小说改写成适配 AI 漫剧的剧本：开头打造爆款钩子，结尾留悬念伏笔，删减拖沓剧情。\n\n{{input}}',
  image: '电影感打光，人物特写，冷色调雨夜街道，超清细节，竖屏构图',
};

const NODE_DEFAULTS = {
  textNode: { label: '文本', content: '' },
  llmNode: { label: '大模型', prompt: '', status: null },
  imageNode: { label: '图像生成', prompt: '', size: '1024x1024', status: null },
  noteNode: { label: '备注', content: '' },
  videoNode: { label: '视频生成', prompt: '', ratio: '16:9', duration: 5, status: null },
  uploadNode: { label: '上传', url: '', fileName: '', kind: null },
  assetNode: { label: '素材库', url: '', assetId: null, kind: null },
  scriptNode: { label: '剧本引用', scriptId: '', includeOutline: true },
  audioNode: { label: '音频节点', text: '' },
  gridNode: { label: '九宫格生图', prompt: '', count: 9, size: '1024x1024', images: [], status: null },
};

let seq = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function starterGraph() {
  return {
    nodes: [
      { id: 'n_text', type: 'textNode', position: { x: 60, y: 160 }, data: { label: '小说原文', content: SAMPLE.text } },
      { id: 'n_llm', type: 'llmNode', position: { x: 400, y: 120 }, data: { label: '剧本改编', prompt: SAMPLE.llm, status: null } },
      { id: 'n_img', type: 'imageNode', position: { x: 760, y: 150 }, data: { label: '分镜生图', prompt: SAMPLE.image, size: '1024x1536', status: null } },
      { id: 'n_note', type: 'noteNode', position: { x: 400, y: 470 }, data: { label: '备注', content: '选中任意节点 → 点「运行」：会先跑它的上游，再跑它自己。\n\n提示：双击空白处可以打开「添加节点」面板。' } },
    ],
    edges: [
      { id: 'e1', source: 'n_text', target: 'n_llm', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e2', source: 'n_llm', target: 'n_img', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

function upstreamOf(id, edges) {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of edges) {
      if (e.target === cur && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source); }
    }
  }
  return seen;
}

export default function CanvasView({ notify }) {
  const [canvases, setCanvases] = useState([]);
  const [canvasId, setCanvasId] = useState(null);
  const [title, setTitle] = useState('');
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [selectedIds, setSelectedIds] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [savedAt, setSavedAt] = useState(null);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetTarget, setSnippetTarget] = useState(null);
  const [menu, setMenu] = useState(null);
  const [palette, setPalette] = useState(null); // null | { flow: {x,y} }

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  const skipSave = useRef(true);
  const past = useRef([]);
  const future = useRef([]);
  const { screenToFlowPosition, setViewport: setFlowViewport } = useReactFlow();

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const loadCanvas = useCallback(async (id) => {
    const data = await api.getCanvas(id);
    const c = data.canvas || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    skipSave.current = true;
    setCanvasId(id);
    setTitle(data.title);
    setNodes(c.nodes || []);
    setEdges(c.edges || []);
    setViewport(c.viewport || { x: 0, y: 0, zoom: 1 });
    setFlowViewport(c.viewport || { x: 0, y: 0, zoom: 1 });
    past.current = []; future.current = [];
    setSavedAt(new Date());
  }, [setNodes, setEdges, setFlowViewport]);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listCanvases();
        setCanvases(list);
        if (list.length) await loadCanvas(list[0].id);
        else {
          const created = await api.createCanvas({ title: '示例画布' });
          await api.updateCanvas(created.id, { canvas: starterGraph() });
          setCanvases(await api.listCanvases());
          await loadCanvas(created.id);
        }
      } catch (e) { notify(`画布初始化失败：${e.message}`, true); }
    })();
  }, [loadCanvas, notify]);

  useEffect(() => {
    if (!canvasId) return;
    if (skipSave.current) { skipSave.current = false; return; }
    const t = setTimeout(async () => {
      try {
        await api.updateCanvas(canvasId, { title, canvas: { nodes, edges, viewport } });
        setSavedAt(new Date());
      } catch (e) { notify(`保存失败：${e.message}`, true); }
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, edges, viewport, title, canvasId, notify]);

  const pushHistory = useCallback(() => {
    past.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return notify('没有可撤销的操作');
    future.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    setNodes(prev.nodes); setEdges(prev.edges);
  }, [setNodes, setEdges, notify]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return notify('没有可重做的操作');
    past.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    setNodes(next.nodes); setEdges(next.edges);
  }, [setNodes, setEdges, notify]);

  const onNodesChange = useCallback((changes) => {
    if (changes.some((c) => c.type === 'remove')) pushHistory();
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, [setNodes, pushHistory]);

  const onEdgesChange = useCallback((changes) => {
    if (changes.some((c) => c.type === 'remove')) pushHistory();
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, [setEdges, pushHistory]);

  const onConnect = useCallback((params) => {
    pushHistory();
    setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [setEdges, pushHistory]);

  const updateNode = useCallback((id, patch) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  const deleteNode = useCallback((id) => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, [setNodes, setEdges, pushHistory]);

  const addNode = useCallback((type, pos) => {
    pushHistory();
    const defaults = NODE_DEFAULTS[type] || {};
    const position = pos || screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setNodes((nds) => nds.concat({ id: newId('n'), type, position, data: { ...defaults } }));
  }, [setNodes, screenToFlowPosition, pushHistory]);

  const run = useCallback(async (targetIds) => {
    const targets = targetIds?.length ? targetIds : [];
    const affected = targets.length
      ? new Set(targets.flatMap((id) => [...upstreamOf(id, edgesRef.current)]))
      : null;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    setNodes((nds) => nds.map((n) => {
      const hit = !affected || affected.has(n.id);
      if (!hit || ['textNode', 'noteNode', 'uploadNode', 'assetNode', 'scriptNode', 'audioNode'].includes(n.type)) return n;
      return { ...n, data: { ...n.data, status: 'running', error: null } };
    }));

    const applyPatch = (nodeId, patch) => {
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    };

    try {
      const res = await api.run({
        canvasId,
        canvas: { nodes: nodesRef.current, edges: edgesRef.current, viewport: viewportRef.current },
        nodeIds: targets,
      }, {
        onEvent: ({ event, data }) => {
          if (event === 'node') {
            // 实时刷新节点状态 + 结果回写（imageUrl / videoUrl / images / output / modelUsed 等）
            const patch = { status: data.status };
            if (data.error) patch.error = data.error;
            if (typeof data.ms === 'number') patch.lastMs = data.ms;
            if (data.imageUrl) patch.imageUrl = data.imageUrl;
            if (data.videoUrl) patch.videoUrl = data.videoUrl;
            if (Array.isArray(data.images)) patch.images = data.images;
            if (typeof data.pickedIndex === 'number') patch.pickedIndex = data.pickedIndex;
            if (data.output) patch.output = data.output;
            if (data.modelUsed) patch.modelUsed = data.modelUsed;
            if (data.tokens != null) patch.tokens = data.tokens;
            if (data.scriptTitle) patch.scriptTitle = data.scriptTitle;
            if (data.promptUsed) patch.promptUsed = data.promptUsed;
            applyPatch(data.nodeId, patch);
          } else if (event === 'progress') {
            setProgress({ done: data.done, total: data.total });
          } else if (event === 'fatal') {
            notify(`执行失败：${data.message}`, true);
          }
        },
      });
      // done 事件后：清理残留 running 状态
      setNodes((nds) => nds.map((n) => (n.data.status === 'running' ? { ...n, data: { ...n.data, status: null } } : n)));
      const errCount = res.errors?.length || 0;
      const msg = errCount
        ? `执行结束：${res.totalNodes - errCount}/${res.totalNodes} 节点成功（${res.ms} ms）`
        : `执行完成：${res.totalNodes} 个节点，${res.stages} 个 stage（${res.ms} ms）`;
      notify(msg, errCount > 0);
    } catch (e) {
      notify(`执行失败：${e.message}`, true);
      setNodes((nds) => nds.map((n) => (n.data.status === 'running' ? { ...n, data: { ...n.data, status: 'error', error: e.message } } : n)));
    } finally {
      setRunning(false);
      setTimeout(() => setProgress({ done: 0, total: 0 }), 2000);
    }
  }, [canvasId, setNodes, notify]);

  const createCanvas = useCallback(async (withSample) => {
    try {
      const created = await api.createCanvas({ title: withSample ? '示例画布' : '未命名画布' });
      if (withSample) await api.updateCanvas(created.id, { canvas: starterGraph() });
      setCanvases(await api.listCanvases());
      await loadCanvas(created.id);
      notify('已新建画布');
    } catch (e) { notify(e.message, true); }
  }, [loadCanvas, notify]);

  const removeCanvas = useCallback(async () => {
    if (!canvasId) return;
    if (!window.confirm('确定删除当前画布？该操作不可恢复。')) return;
    try {
      await api.deleteCanvas(canvasId);
      const list = await api.listCanvases();
      setCanvases(list);
      if (list.length) await loadCanvas(list[0].id);
      else { setNodes([]); setEdges([]); setCanvasId(null); setTitle(''); }
      notify('画布已删除');
    } catch (e) { notify(e.message, true); }
  }, [canvasId, loadCanvas, setNodes, setEdges, notify]);

  const onPaneContextMenu = useCallback((event) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }, [screenToFlowPosition]);

  const onPaneDoubleClick = useCallback((event) => {
    event.preventDefault();
    if (event.target !== event.currentTarget && event.target.closest('.react-flow__node')) return;
    setPalette({ flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }, [screenToFlowPosition]);

  const onDrop = useCallback(async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      try {
        const { url } = await api.upload({ name: file.name, dataUrl });
        pushHistory();
        setNodes((nds) => nds.concat({
          id: newId('n'), type: 'uploadNode',
          position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          data: { label: file.name, url, fileName: file.name, kind: 'image' },
        }));
      } catch (e) { notify(e.message, true); }
    } else if (file.type.startsWith('video/')) {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
      try {
        const { url } = await api.upload({ name: file.name, dataUrl });
        pushHistory();
        setNodes((nds) => nds.concat({
          id: newId('n'), type: 'uploadNode',
          position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          data: { label: file.name, url, fileName: file.name, kind: 'video' },
        }));
      } catch (e) { notify(e.message, true); }
    }
  }, [setNodes, screenToFlowPosition, pushHistory, notify]);

  const openSnippets = useCallback((nodeId) => { setSnippetTarget(nodeId); setShowSnippets(true); }, []);
  const insertSnippet = useCallback((content) => {
    if (!snippetTarget) return;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== snippetTarget) return n;
      const cur = n.data.prompt || '';
      return { ...n, data: { ...n.data, prompt: cur ? `${cur}\n\n${content}` : content } };
    }));
    notify('已插入到节点提示词');
  }, [snippetTarget, setNodes, notify]);

  /** 底部浮动工具条：在选中节点的提示词里追加特殊标记 / 引用 */
  const insertMarker = useCallback((marker) => {
    if (!selectedIds.length) return notify('请先选中一个节点');
    setNodes((nds) => nds.map((n) => {
      if (!selectedIds.includes(n.id)) return n;
      const cur = n.data.prompt || '';
      return { ...n, data: { ...n.data, prompt: cur ? `${cur} ${marker}` : marker } };
    }));
    notify(`已插入「${marker}」`);
  }, [selectedIds, setNodes, notify]);

  const ctx = useMemo(() => ({
    updateNode, deleteNode, runNode: (id) => run([id]), openSnippets,
    copy: (t) => { navigator.clipboard.writeText(t || ''); notify('已复制到剪贴板'); },
  }), [updateNode, deleteNode, run, openSnippets, notify]);

  const selectedNode = selectedIds.length === 1 ? nodes.find((n) => n.id === selectedIds[0]) : null;
  const supportsMarkers = selectedNode && ['llmNode', 'imageNode', 'videoNode', 'gridNode'].includes(selectedNode.type);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="view-bar">
        <select style={{ width: 190 }} value={canvasId || ''} onChange={(e) => loadCanvas(e.target.value)}>
          {canvases.map((c) => <option key={c.id} value={c.id}>{c.title}（{c.node_count ?? 0} 节点）</option>)}
        </select>
        <button onClick={() => createCanvas(false)}>新建</button>
        <button onClick={() => createCanvas(true)}>示例画布</button>
        <button onClick={removeCanvas}>删除</button>
        <div className="sep" />
        <input style={{ width: 150 }} value={title} placeholder="画布名称" onChange={(e) => setTitle(e.target.value)} />
        <div className="sep" />
        <button className="primary" onClick={() => setPalette({ flow: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) })}>+ 添加节点</button>
        <div className="sep" />
        <button onClick={undo}>撤销</button>
        <button onClick={redo}>重做</button>
        <div className="spacer" />
        {progress.total > 0 && running && (
          <span className="pill" style={{ minWidth: 120 }}>
            <span style={{ display: 'inline-block', width: 80, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle' }}>
              <span style={{ display: 'block', height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: '#10B981', transition: 'width 0.2s' }} />
            </span>
            <span style={{ marginLeft: 6, fontSize: 12 }}>{progress.done}/{progress.total}</span>
          </span>
        )}
        <span className="pill">{savedAt ? `已保存 ${savedAt.toLocaleTimeString('zh-CN')}` : '未保存'}</span>
        <button onClick={() => { setSnippetTarget(selectedIds[0] || null); setShowSnippets((v) => !v); }}>片段库</button>
        <button className="primary" disabled={running} onClick={() => run(selectedIds.length ? selectedIds : [])}>
          {running ? '执行中…' : selectedIds.length ? '▶ 运行所选' : '▶ 运行全部'}
        </button>
      </div>

      <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => setMenu(null)}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: sel }) => setSelectedIds(sel.map((n) => n.id))}
          onMoveEnd={(_, vp) => setViewport(vp)}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => setPalette(null)}
          onDoubleClick={onPaneDoubleClick}
          defaultViewport={viewport}
          fitView={false}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dfe3e8" />
          <Controls />
          <MiniMap pannable zoomable nodeStrokeWidth={2} style={{ background: '#fff' }} />
        </ReactFlow>

        {!nodes.length && <div className="center-hint">画布是空的 — 双击空白处打开「添加节点」面板，或拖入图片/视频</div>}

        {menu && (
          <div className="panel" style={{ left: menu.x, right: 'auto', top: menu.y, width: 200 }}>
            <div className="panel-body">
              <button onClick={() => { setPalette({ flow: menu.flow }); setMenu(null); }}>＋ 打开节点面板…</button>
              <div className="hint" style={{ padding: '6px 4px', color: '#999', fontSize: 12 }}>或双击空白处打开</div>
            </div>
          </div>
        )}

        <NodePalette
          open={!!palette}
          onPick={(type) => { addNode(type, palette.flow); setPalette(null); }}
          onClose={() => setPalette(null)}
        />

        <SnippetsPanel
          open={showSnippets}
          targetNodeId={snippetTarget}
          onInsert={insertSnippet}
          onClose={() => setShowSnippets(false)}
          notify={notify}
        />

        {/* 底部浮动工具条：选中节点时显示参考 / 标记 / 特效 / 角色库 / 运镜 快捷入口 */}
        {selectedNode && (
          <div className="canvas-floating-bar nodrag">
            <span className="cfb-title">{selectedNode.data.label || selectedNode.type}</span>
            {supportsMarkers && (
              <>
                <button onClick={() => insertMarker('@参考')}>＋ 参考</button>
                <button onClick={() => insertMarker('@标记')}>＋ 标记</button>
                <button onClick={() => openSnippets(selectedNode.id)}>＋ 特效</button>
                <button onClick={() => insertMarker('@角色')}>＋ 角色库</button>
                <button onClick={() => insertMarker('@运镜')}>＋ 运镜</button>
              </>
            )}
          </div>
        )}
      </div>
    </CanvasCtx.Provider>
  );
}