import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, MarkerType,
  useNodesState, useEdgesState, addEdge, applyNodeChanges, applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import { api } from '../api.js';
import { CanvasCtx, useApp } from '../context.js';
import { buildRefs } from '../refs.js';
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
import ComposeNode from '../nodes/ComposeNode.jsx';
import DirectorNode from '../nodes/DirectorNode.jsx';
import BatchUploadNode from '../nodes/BatchUploadNode.jsx';
import SnippetsPanel from '../components/SnippetsPanel.jsx';
import NodePalette from '../components/NodePalette.jsx';
import CanvasAssistantPanel from '../components/CanvasAssistantPanel.jsx';
import { getAutoConnectParams } from './canvasConnections.js';
import { getAutoLayoutPositions } from './canvasLayout.js';
import { createCanvasSaveQueue } from './canvasSaveQueue.js';

const nodeTypes = {
  textNode: TextNode, llmNode: LlmNode, imageNode: ImageNode, noteNode: NoteNode,
  videoNode: VideoNode, uploadNode: UploadNode, assetNode: AssetNode,
  scriptNode: ScriptNode, audioNode: AudioNode, gridNode: GridNode,
  composeNode: ComposeNode, directorNode: DirectorNode, batchUploadNode: BatchUploadNode,
};

const SAMPLE = {
  text: '"分手吧！"\n\n接到电话的陈默，苦涩地笑着。他理解平绮绮的选择，毕竟在这个时代，有多少人愿意陪着另一半过苦日子呢？\n\n"明白了。"挂断电话，他握紧了兜里那张皱巴巴的录取通知书。',
  llm: '你是资深 AI 漫剧策划，请把下面这段小说改写成适配 AI 漫剧的剧本：开头打造爆款钩子，结尾留悬念伏笔，删减拖沓剧情。\n\n{{input}}',
  image: '电影感打光，人物特写，冷色调雨夜街道，超清细节，竖屏构图',
};

const NODE_DEFAULTS = {
  textNode: { label: '文本', content: '' },
  llmNode: { label: '大模型', prompt: '', status: null },
  imageNode: { label: '图片', prompt: '', ratio: '16:9', quality: '1K', size: '1536x864', status: null },
  noteNode: { label: '便签', content: '' },
  videoNode: { label: '视频', prompt: '', mode: 'text', ratio: '16:9', resolution: '720p', duration: 5, status: null },
  uploadNode: { label: '上传', url: '', fileName: '', kind: null },
  assetNode: { label: '素材库', url: '', assetId: null, kind: null },
  scriptNode: { label: '分镜脚本', scriptId: '', includeOutline: true },
  audioNode: { label: '音频', text: '' },
  gridNode: { label: '分镜格子', prompt: '', count: 9, size: '1024x1024', images: [], status: null },
  composeNode: { label: '视频合成', ratio: '16:9', imageSeconds: 3, status: null },
  directorNode: { label: '运镜提示', cameraShot: 'orbit', subject: '', space: '', output: '' },
  batchUploadNode: { label: '批量上传', items: [] },
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

export default function CanvasView({ notify }) {
  const { modelGroups, modelDefaults, imageProviders, imageDefaultProvider, videoProviders, videoDefaultProvider, videoDefaultModel, videoModelCapabilities, videoModelPrices, setView, openProject, script } = useApp();
  const textDefaultModel = modelDefaults?.text || '';
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
  const [saveStatus, setSaveStatus] = useState('unsaved');
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetTarget, setSnippetTarget] = useState(null);
  const [menu, setMenu] = useState(null);
  const [palette, setPalette] = useState(null); // null | { flow: {x,y}, connection?: {nodeId, handleType, handleId} }
  /* 画布 chrome 开关（对齐 LibTV 左下控件条） */
  const [snapGrid, setSnapGrid] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [hideEdges, setHideEdges] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAssistant, setShowAssistant] = useState(true);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  const skipSave = useRef(true);
  const past = useRef([]);
  const future = useRef([]);
  /* 撤销栈高度用 state 镜像一份：past/future 是 ref（写入不触发重渲染），
     工具栏按钮的 disabled 需要真实可撤销/可重做态，否则只能读全局 window.history。
     每次 pushHistory/undo/redo 后同步这两位。 */
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const saveQueueRef = useRef(null);
  if (!saveQueueRef.current) {
    saveQueueRef.current = createCanvasSaveQueue({
      save: (snapshot) => api.updateCanvas(snapshot.canvasId, {
        title: snapshot.title, canvas: snapshot.canvas,
      }),
      onState: (state, _snapshot, error) => {
        setSaveStatus(state);
        if (state === 'unsaved') setSavedAt(null);
        if (state === 'saved') setSavedAt(new Date());
        if (state === 'error') notify(`保存失败：${error.message}`, true);
      },
    });
  }
  const { screenToFlowPosition, setViewport: setFlowViewport, fitView } = useReactFlow();

  const onSelectionChange = useCallback(({ nodes: sel }) => {
    const next = sel.map((n) => n.id);
    setSelectedIds((prev) => (
      prev.length === next.length && prev.every((id, index) => id === next[index]) ? prev : next
    ));
  }, []);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const loadCanvas = useCallback(async (id) => {
    await saveQueueRef.current.flush();
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
    setCanUndo(false); setCanRedo(false);
    setSavedAt(new Date());
    setSaveStatus('saved');
  }, [setNodes, setEdges, setFlowViewport]);

  useEffect(() => () => { void saveQueueRef.current.flush().catch(() => {}); }, []);

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
    saveQueueRef.current.schedule({ canvasId, title, canvas: { nodes, edges, viewport } });
  }, [nodes, edges, viewport, title, canvasId]);

  const pushHistory = useCallback(() => {
    past.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setCanUndo(past.current.length > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return notify('没有可撤销的操作');
    future.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    setNodes(prev.nodes); setEdges(prev.edges);
    setCanUndo(past.current.length > 0);
    setCanRedo(true);
  }, [setNodes, setEdges, notify]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return notify('没有可重做的操作');
    past.current.push({ nodes: structuredClone(nodesRef.current), edges: structuredClone(edgesRef.current) });
    setNodes(next.nodes); setEdges(next.edges);
    setCanUndo(true);
    setCanRedo(future.current.length > 0);
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

  /* 双击一条连线 → 只断开这一条（走 pushHistory，在画布内按 Ctrl/Cmd+Z 可撤销）。
     与「双击空白弹添加菜单」的 capture 处理器共存：onPaneDoubleClick 已排除 .react-flow__edge，
     所以双击边不会同时弹出菜单。 */
  const onEdgeDoubleClick = useCallback((event, edge) => {
    event.preventDefault();
    pushHistory();
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    notify('已断开连接');
  }, [setEdges, pushHistory, notify]);

  const updateNode = useCallback((id, patch) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  const deleteNode = useCallback((id) => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, [setNodes, setEdges, pushHistory]);

  /* 空位搜索：面板添加 / 双击菜单的落点若已被占用，按网格向外环形找空位。
     网格单元取节点footprint（约 540×400）加留白，保证新节点之间不重叠。 */
  const freeSpot = useCallback((base) => {
    const cellW = 560, cellH = 440;
    const taken = (p) => nodesRef.current.some((n) => (
      Math.abs(n.position.x - p.x) < cellW * 0.6 && Math.abs(n.position.y - p.y) < cellH * 0.6));
    const ring = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [1, 2], [-1, 2], [-2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1]];
    for (const [cx, cy] of ring) {
      const p = { x: base.x + cx * cellW, y: base.y + cy * cellH };
      if (!taken(p)) return p;
    }
    return { x: base.x, y: base.y };
  }, []);

  const addNode = useCallback((type, pos, connection) => {
    pushHistory();
    const defaults = NODE_DEFAULTS[type] || {};
    let position = pos;
    if (!position) {
      const k = nodesRef.current.length % 8;
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      position = freeSpot({ x: center.x + k * 60, y: center.y + k * 44 });
    } else {
      position = freeSpot(position);
    }
    const id = newId('n');
    setNodes((nds) => nds.concat({
      id, type, position,
      data: { ...defaults, ...(type === 'textNode' && textDefaultModel ? { processWithModel: true } : {}) },
    }));
    if (connection) {
      const params = getAutoConnectParams({ connection, nodeId: id, nodeType: type });
      if (params) {
        setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
      } else {
        notify('模块已添加，但没有兼容的连接端口');
      }
    }
    return id;
  }, [setNodes, setEdges, screenToFlowPosition, pushHistory, freeSpot, notify, textDefaultModel]);

  /* 整理画布：图片、视频分别纵向成列，其他节点放在独立列。 */
  const autoLayout = useCallback(() => {
    const list = [...nodesRef.current];
    if (list.length < 2) { notify('至少要有两个节点才需要整理'); return; }
    pushHistory();
    const posOf = getAutoLayoutPositions(list);
    setNodes((nds) => nds.map((n) => (posOf.has(n.id) ? { ...n, position: posOf.get(n.id) } : n)));
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
    notify(`已整理 ${list.length} 个节点`);
  }, [setNodes, pushHistory, notify, fitView]);

  // Alt+Shift+F 快捷键（与 LibTV 一致）
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); autoLayout(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autoLayout]);

  /* 撤销 / 重做快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 重做。
     在输入框 / 文本域 / contenteditable 内按 Ctrl+Z 时放行，保留浏览器原生的文本撤销，不抢。
     只在命中处理时才 preventDefault，避免影响其它组合键。 */
  useEffect(() => {
    const isEditable = (el) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    };
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || (e.key !== 'z' && e.key !== 'Z')) return;
      if (isEditable(e.target)) return; // 输入场景交给浏览器原生撤销
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const run = useCallback(async (targetIds, { fresh = false } = {}) => {
    const targets = targetIds?.length ? targetIds : [];
    const affected = targets.length ? new Set(targets) : null;
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    setNodes((nds) => nds.map((n) => {
      const hit = !affected || affected.has(n.id);
      if (!hit || ['noteNode', 'uploadNode', 'assetNode', 'scriptNode', 'audioNode'].includes(n.type)) return n;
      return { ...n, data: { ...n.data, status: 'running', error: null } };
    }));

    const applyPatch = (nodeId, patch) => {
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    };

    try {
      const res = await api.run({
        canvasId,
        scriptId: script?.id || null,
        canvas: { nodes: nodesRef.current, edges: edgesRef.current, viewport: viewportRef.current },
        nodeIds: targets,
        freshNodeIds: fresh ? targets : [],
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
            if (Array.isArray(data.urls)) patch.urls = data.urls;
            if (typeof data.pickedIndex === 'number') patch.pickedIndex = data.pickedIndex;
            if (data.output) patch.output = data.output;
            if (data.modelUsed) patch.modelUsed = data.modelUsed;
            if (data.tokens != null) patch.tokens = data.tokens;
            if (data.scriptTitle) patch.scriptTitle = data.scriptTitle;
            if (data.promptUsed) patch.promptUsed = data.promptUsed;
            if (data.upstreamTask) patch.upstreamTask = data.upstreamTask;
            if (data.generationPhase) patch.generationPhase = data.generationPhase;
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
  }, [canvasId, script?.id, setNodes, notify]);

  const createCanvas = useCallback(async (withSample) => {
    try {
      await saveQueueRef.current.flush();
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
      await saveQueueRef.current.flush();
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
    // 双击节点内部 / 菜单内部 / 连线 不触发添加节点菜单
    if (event.target?.closest?.('.react-flow__node')) return;
    if (event.target?.closest?.('.palette')) return;
    // 连线在 .react-flow__edge 上（不在 node 上）：排除它，避免「双击断开」的同时弹出添加菜单
    if (event.target?.closest?.('.react-flow__edge')) return;
    event.preventDefault();
    setPalette({ flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
  }, [screenToFlowPosition]);

  const onConnectEnd = useCallback((event, connectionState) => {
    if (!connectionState?.fromNode || !connectionState.fromHandle || connectionState.toNode) return;
    const point = event.changedTouches?.[0] || event;
    const target = document.elementFromPoint(point.clientX, point.clientY);
    if (!target?.closest?.('.react-flow__pane') || target.closest('.react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .palette')) return;
    setPalette({
      flow: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      connection: {
        nodeId: connectionState.fromNode.id,
        handleType: connectionState.fromHandle.type,
        handleId: connectionState.fromHandle.id,
      },
    });
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

  /* 上游素材引用表：连线传进来的图片/视频按顺序编号（图片1..n / 视频1..n）。
     节点用它渲染「参考」缩略图行与 @ 引用，并写进 node.data.mediaRefs，
     后端 engine.js 按同名 key 解析 @图片N，保证两端编号一致。
     节点组件通过 useStore 订阅图结构，把最新的 nodes/edges 传进来（graph 参数），
     不能只读 ref —— ref 在 effect 里更新，会有一帧延迟且节点不会重渲染。 */
  const refsOf = useCallback((nodeId, graph) => (
    buildRefs(nodeId, graph?.nodes || nodesRef.current, graph?.edges || edgesRef.current)
  ), []);

  const ctx = useMemo(() => ({
    updateNode, deleteNode, runNode: (id, options) => run([id], options), openSnippets, refsOf,
    copy: (t) => { navigator.clipboard.writeText(t || ''); notify('已复制到剪贴板'); },
    textModels: modelGroups?.text || [],
    textDefaultModel,
    imageModels: modelGroups?.image || [],
    imageProviders: imageProviders || [],
    imageDefaultProvider: imageDefaultProvider || null,
    videoModels: modelGroups?.video || [],
    videoDefaultModel: videoDefaultModel || '',
    videoModelCapabilities: videoModelCapabilities || {},
    videoModelPrices: videoModelPrices || {},
    videoProviders: videoProviders || [],
    videoDefaultProvider: videoDefaultProvider || null,
    openStyles: () => openProject?.(script?.id, 'assets'),
  }), [updateNode, deleteNode, run, openSnippets, refsOf, notify, modelGroups, textDefaultModel, imageProviders, imageDefaultProvider, videoProviders, videoDefaultProvider, videoDefaultModel, videoModelCapabilities, videoModelPrices, openProject, script?.id]);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="view-bar cv-topbar">
        <span className="cv-brand">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M5 5h6v6H5zM13 5h6v6h-6zM9 13h6v6H9zM11 8h2M12 11v2" />
          </svg>
        </span>
        <input className="cv-name" style={{ width: 160 }} value={title} placeholder="画布名称" onChange={(e) => setTitle(e.target.value)} />
        <select className="cv-picker" style={{ width: 150 }} value={canvasId || ''}
          onChange={(e) => loadCanvas(e.target.value).catch((error) => notify(`切换画布失败：${error.message}`, true))}>
          {canvases.map((c) => <option key={c.id} value={c.id}>{c.title}（{c.node_count ?? 0} 节点）</option>)}
        </select>
        <button className="ghost tiny" title="新建画布" onClick={() => createCanvas(false)}>＋</button>
        <button className="ghost tiny" title="删除画布" onClick={removeCanvas}>×</button>
        <div className="sep" />
        <div className="cv-tabs"><button className="cv-tab on">画布</button></div>
        <div className="spacer" />
        {progress.total > 0 && running && (
          <span className="pill" style={{ minWidth: 120 }}>
            <span style={{ display: 'inline-block', width: 80, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle' }}>
              <span style={{ display: 'block', height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: '#10B981', transition: 'width 0.2s' }} />
            </span>
            <span style={{ marginLeft: 6, fontSize: 12 }}>{progress.done}/{progress.total}</span>
          </span>
        )}
        <button className="ghost tiny" title="撤销 (Ctrl+Z)" onClick={undo} disabled={!canUndo}>↶</button>
        <button className="ghost tiny" title="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>↷</button>
        <span className="pill">{saveStatus === 'saved' && savedAt
          ? `已保存 ${savedAt.toLocaleTimeString('zh-CN')}`
          : ({ saving: '保存中…', error: '保存失败', unsaved: '未保存' })[saveStatus] || '未保存'}</span>
        {saveStatus === 'error' && <button className="ghost tiny" title="重试保存"
          onClick={() => saveQueueRef.current.flush().catch(() => {})}>重试</button>}
        <button className={`ghost ${showAssistant ? 'on' : ''}`} title={showAssistant ? '收起 Agent 与任务面板' : '打开 Agent 与任务面板'} onClick={() => setShowAssistant((value) => !value)}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ marginRight: 5, verticalAlign: -2 }}>
            <path d="M12 2v3M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9.5 16h5" />
          </svg>
          Agent 与任务
        </button>
      </div>

      <div className={`canvas-wrap ${showAssistant ? 'cv-with-assistant' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
        onClick={() => setMenu(null)} onDoubleClickCapture={onPaneDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={hideEdges ? [] : edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onSelectionChange={onSelectionChange}
          onMoveEnd={(_, vp) => setViewport(vp)}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => setPalette(null)}
          zoomOnDoubleClick={false}
          snapToGrid={snapGrid}
          snapGrid={[18, 18]}
          defaultViewport={viewport}
          fitView={false}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dfe3e8" />
          {showMap && <MiniMap pannable zoomable nodeStrokeWidth={2} style={{ background: '#fff' }} />}
        </ReactFlow>

        {/* 空画布引导（对齐 LibTV：双击提示 + 快捷卡片） */}
        {!nodes.length && (
          <div className="cv-empty">
            <div className="cv-empty-tip">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 3l7 17 2.5-6.5L20 11z" />
              </svg>
              双击画布 · 自由生成节点
            </div>
            <div className="cv-empty-cards">
              <button className="cv-ecard e0" onClick={() => addNode('scriptNode')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 3h9l5 5v13H6zM15 3v5h5" />
                </svg>
                <b>添加脚本节点</b>
              </button>
              <button className="cv-ecard e1" onClick={() => addNode('batchUploadNode')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0" />
                </svg>
                <b>导入资源节点</b>
              </button>
              <button className="cv-ecard e2" onClick={() => addNode('imageNode')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" />
                </svg>
                <b>图片生成</b>
              </button>
              <button className="cv-ecard e3" onClick={() => addNode('videoNode')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />
                </svg>
                <b>图生视频</b>
              </button>
            </div>
          </div>
        )}

        {/* 底部居中悬浮工具条（对齐 LibTV） */}
        <div className="cv-dock">
          <button className="cv-dock-btn on" title="添加节点"
            onClick={() => setPalette({ flow: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) })}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button className="cv-dock-btn" title="适应视图" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></svg>
          </button>
          <button className="cv-dock-btn" title="片段库（提示词模板）"
            onClick={() => { setSnippetTarget(selectedIds[0] || null); setShowSnippets((v) => !v); }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          </button>
          <button className="cv-dock-btn" title="快捷键" onClick={() => setShowHelp(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16v10H4zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M9 14h6" /></svg>
          </button>
          <button className="cv-dock-btn" title="教程（示例画布）" onClick={() => createCanvas(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3 2.4V13M12 16h.01" /></svg>
          </button>
        </div>

        {/* 左下控件条（对齐 LibTV） */}
        <div className="cv-corner">
          <span className="cv-corner-tag">{nodes.length} 节点</span>
          <button className="cv-corner-btn" title="整理画布（Alt+Shift+F）" onClick={autoLayout}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" /></svg>
          </button>
          <button className={`cv-corner-btn ${showMap ? 'on' : ''}`} title="切换小地图" onClick={() => setShowMap((v) => !v)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14" /></svg>
          </button>
          <button className={`cv-corner-btn ${hideEdges ? 'on' : ''}`} title="隐藏节点连线" onClick={() => setHideEdges((v) => !v)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 8h5a4 4 0 0 1 4 4 4 4 0 0 0 4 4h2" /><path d="M3 3l18 18" /></svg>
          </button>
          <button className={`cv-corner-btn ${snapGrid ? 'on' : ''}`} title="网格吸附" onClick={() => setSnapGrid((v) => !v)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 9h16M4 15h16M9 4v16M15 4v16" /></svg>
          </button>
          <button className="cv-corner-btn" title="适应视图并重置缩放" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
            {Math.round((viewport?.zoom || 1) * 100)}%
          </button>
        </div>

        {showHelp && (
          <div className="panel cv-help" style={{ left: 16, top: 70, width: 260 }}>
            <h3>快捷键与操作<span className="ghost tiny" style={{ cursor: 'pointer' }} onClick={() => setShowHelp(false)}>×</span></h3>
            <div className="panel-body" style={{ fontSize: 12, lineHeight: 1.9 }}>
              <div><b>双击空白</b> 打开「添加节点」面板</div>
              <div><b>拖入文件</b> 直接生成上传节点</div>
              <div><b>Ctrl + Enter</b> 在节点内触发生成</div>
              <div><b>Alt + Shift + F</b> 整理画布</div>
              <div><b>Delete / Backspace</b> 删除选中节点</div>
              <div><b>连线</b> 图片 → 视频可传递首帧参考</div>
              <div><b>运行</b> 先跑上游，再跑选中节点</div>
            </div>
          </div>
        )}

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
          onPick={(item) => {
            if (item && typeof item === 'object') {
              if (item.action === 'assets') setView?.('characters');
              if (item.action === 'history') setView?.('media');
            } else {
              addNode(item, palette.flow, palette.connection);
            }
            setPalette(null);
          }}
          onClose={() => setPalette(null)}
        />

        <SnippetsPanel
          open={showSnippets}
          targetNodeId={snippetTarget}
          onInsert={insertSnippet}
          onClose={() => setShowSnippets(false)}
          notify={notify}
        />
        <CanvasAssistantPanel open={showAssistant} onClose={() => setShowAssistant(false)} notify={notify} />
      </div>
    </CanvasCtx.Provider>
  );
}
