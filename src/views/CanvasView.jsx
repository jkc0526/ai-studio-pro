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
  videoNode: { label: '视频', prompt: '', mode: 'text', ratio: '16:9', resolution: '1080p', duration: 5, status: null },
  uploadNode: { label: '上传', url: '', fileName: '', kind: null },
  assetNode: { label: '素材库', url: '', assetId: null, kind: null },
  scriptNode: { label: '分镜脚本', scriptId: '', includeOutline: true },
  audioNode: { label: '音频', text: '' },
  gridNode: { label: '分镜格子', prompt: '', count: 9, size: '1024x1024', images: [], status: null },
  composeNode: { label: '视频合成', ratio: '16:9', imageSeconds: 3, status: null },
  directorNode: { label: '3D导演台', cameraShot: 'orbit', subject: '', space: '', output: '' },
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
  const { modelGroups, setView } = useApp();
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
  /* 画布 chrome 开关（对齐 LibTV 左下控件条） */
  const [snapGrid, setSnapGrid] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [hideEdges, setHideEdges] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  const skipSave = useRef(true);
  const past = useRef([]);
  const future = useRef([]);
  const { screenToFlowPosition, setViewport: setFlowViewport, fitView } = useReactFlow();

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

  const addNode = useCallback((type, pos) => {
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
    setNodes((nds) => nds.concat({ id: newId('n'), type, position, data: { ...defaults } }));
  }, [setNodes, screenToFlowPosition, pushHistory, freeSpot]);

  /* 整理画布（对齐 LibTV 的 Alt+Shift+F）：按现有坐标的行列顺序，
     把节点重新排到 560×440 的整齐网格上，消除重叠与参差。 */
  const autoLayout = useCallback(() => {
    const list = [...nodesRef.current];
    if (list.length < 2) { notify('至少要有两个节点才需要整理'); return; }
    pushHistory();
    const cellW = 560; const cellH = 440;
    const cols = Math.max(1, Math.round(Math.sqrt(list.length)));
    const sorted = [...list].sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
    const originX = Math.min(...list.map((n) => n.position.x));
    const originY = Math.min(...list.map((n) => n.position.y));
    const posOf = new Map();
    sorted.forEach((n, i) => {
      posOf.set(n.id, {
        x: Math.round(originX + (i % cols) * cellW),
        y: Math.round(originY + Math.floor(i / cols) * cellH),
      });
    });
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
            if (Array.isArray(data.urls)) patch.urls = data.urls;
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
    // 双击节点内部 / 菜单内部不触发
    if (event.target?.closest?.('.react-flow__node')) return;
    if (event.target?.closest?.('.palette')) return;
    event.preventDefault();
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

  /* 上游素材引用表：连线传进来的图片/视频按顺序编号（图片1..n / 视频1..n）。
     节点用它渲染「参考」缩略图行与 @ 引用，并写进 node.data.mediaRefs，
     后端 engine.js 按同名 key 解析 @图片N，保证两端编号一致。
     节点组件通过 useStore 订阅图结构，把最新的 nodes/edges 传进来（graph 参数），
     不能只读 ref —— ref 在 effect 里更新，会有一帧延迟且节点不会重渲染。 */
  const refsOf = useCallback((nodeId, graph) => (
    buildRefs(nodeId, graph?.nodes || nodesRef.current, graph?.edges || edgesRef.current)
  ), []);

  const ctx = useMemo(() => ({
    updateNode, deleteNode, runNode: (id) => run([id]), openSnippets, refsOf,
    copy: (t) => { navigator.clipboard.writeText(t || ''); notify('已复制到剪贴板'); },
    imageModels: modelGroups?.image || [],
    videoModels: modelGroups?.video || [],
    openStyles: () => setView?.('styles'),
  }), [updateNode, deleteNode, run, openSnippets, refsOf, notify, modelGroups, setView]);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="view-bar cv-topbar">
        <span className="cv-brand">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M5 5h6v6H5zM13 5h6v6h-6zM9 13h6v6H9zM11 8h2M12 11v2" />
          </svg>
        </span>
        <input className="cv-name" style={{ width: 160 }} value={title} placeholder="画布名称" onChange={(e) => setTitle(e.target.value)} />
        <select className="cv-picker" style={{ width: 150 }} value={canvasId || ''} onChange={(e) => loadCanvas(e.target.value)}>
          {canvases.map((c) => <option key={c.id} value={c.id}>{c.title}（{c.node_count ?? 0} 节点）</option>)}
        </select>
        <button className="ghost tiny" title="新建画布" onClick={() => createCanvas(false)}>＋</button>
        <button className="ghost tiny" title="删除画布" onClick={removeCanvas}>×</button>
        <div className="sep" />
        {/* 视图标签页（对齐 LibTV 的画布 / 工作流 / 故事板） */}
        <div className="cv-tabs">
          <button className="cv-tab on">画布</button>
          <button className="cv-tab" title="剧本 → 脚本生成器" onClick={() => setView?.('production')}>工作流</button>
          <button className="cv-tab" title="分镜表与批量出图出片" onClick={() => setView?.('storyboard')}>故事板</button>
        </div>
        <div className="spacer" />
        {progress.total > 0 && running && (
          <span className="pill" style={{ minWidth: 120 }}>
            <span style={{ display: 'inline-block', width: 80, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle' }}>
              <span style={{ display: 'block', height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: '#10B981', transition: 'width 0.2s' }} />
            </span>
            <span style={{ marginLeft: 6, fontSize: 12 }}>{progress.done}/{progress.total}</span>
          </span>
        )}
        <button className="ghost tiny" title="撤销" onClick={undo} disabled={!history.length}>↶</button>
        <button className="ghost tiny" title="重做" onClick={redo}>↷</button>
        <span className="pill">{savedAt ? `已保存 ${savedAt.toLocaleTimeString('zh-CN')}` : '未保存'}</span>
        <button className="ghost" title="打开 Agent 应用" onClick={() => setView?.('agents')}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ marginRight: 5, verticalAlign: -2 }}>
            <path d="M12 2v3M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9.5 16h5" />
          </svg>
          Agent
        </button>
        <button className="primary" disabled={running} onClick={() => run(selectedIds.length ? selectedIds : [])}>
          {running ? '执行中…' : selectedIds.length ? '▶ 运行所选' : '▶ 运行全部'}
        </button>
      </div>

      <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
        onClick={() => setMenu(null)} onDoubleClickCapture={onPaneDoubleClick}>
        <ReactFlow
          nodes={nodes}
          edges={hideEdges ? [] : edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: sel }) => setSelectedIds(sel.map((n) => n.id))}
          onMoveEnd={(_, vp) => setViewport(vp)}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => setPalette(null)}
          zoomOnDoubleClick={false}
          snapToGrid={snapGrid}
          snapGrid={[18, 18]}
          defaultViewport={viewport}
          fitView={false}
          proOptions={{ hideAttribution: true }}
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
              <button className="cv-ecard e0" onClick={() => setView?.('production')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 3h9l5 5v13H6zM15 3v5h5" />
                </svg>
                <b>故事脚本生成</b>
              </button>
              <button className="cv-ecard e1" onClick={() => setView?.('characters')}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0" />
                </svg>
                <b>角色三视图</b>
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
          <button className="cv-dock-btn" title="素材库" onClick={() => setView?.('media')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18v12H3zM8 6l1.5-2h5L16 6M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></svg>
          </button>
          <button className="cv-dock-btn" title="角色库" onClick={() => setView?.('characters')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0" /></svg>
          </button>
          <button className="cv-dock-btn" title="生成历史" onClick={() => setView?.('media')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4" /></svg>
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
      </div>
    </CanvasCtx.Provider>
  );
}