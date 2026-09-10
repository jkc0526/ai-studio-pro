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
import NoteNode from '../nodes/NoteNode.jsx';
import SnippetsPanel from '../components/SnippetsPanel.jsx';

const nodeTypes = { textNode: TextNode, llmNode: LlmNode, imageNode: ImageNode, noteNode: NoteNode };

const SAMPLE = {
  text: '“分手吧！”\n\n接到电话的陈默，苦涩地笑着。他理解平绮绮的选择，毕竟在这个时代，有多少人愿意陪着另一半过苦日子呢？\n\n“明白了。”挂断电话，他握紧了兜里那张皱巴巴的录取通知书。',
  llm: '你是资深 AI 漫剧策划，请把下面这段小说改写成适配 AI 漫剧的剧本：开头打造爆款钩子，结尾留悬念伏笔，删减拖沓剧情。\n\n{{input}}',
  image: '电影感打光，人物特写，冷色调雨夜街道，超清细节，竖屏构图',
};

let seq = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function starterGraph() {
  return {
    nodes: [
      { id: 'n_text', type: 'textNode', position: { x: 60, y: 160 }, data: { label: '小说原文', content: SAMPLE.text } },
      { id: 'n_llm', type: 'llmNode', position: { x: 400, y: 120 }, data: { label: '剧本改编', prompt: SAMPLE.llm, status: null } },
      { id: 'n_img', type: 'imageNode', position: { x: 760, y: 150 }, data: { label: '分镜生图', prompt: SAMPLE.image, size: '1024x1536', status: null } },
      { id: 'n_note', type: 'noteNode', position: { x: 400, y: 470 }, data: { label: '备注', content: '选中任意节点 → 点「运行」：会先跑它的上游，再跑它自己。' } },
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
  const [savedAt, setSavedAt] = useState(null);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetTarget, setSnippetTarget] = useState(null);
  const [menu, setMenu] = useState(null);

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
    const defaults = {
      textNode: { label: '文本', content: '' },
      llmNode: { label: '大模型', prompt: '', status: null },
      imageNode: { label: '图像生成', prompt: '', size: '1024x1024', status: null },
      noteNode: { label: '备注', content: '' },
    }[type] || {};
    const position = pos || screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setNodes((nds) => nds.concat({ id: newId('n'), type, position, data: { ...defaults } }));
  }, [setNodes, screenToFlowPosition, pushHistory]);

  const run = useCallback(async (targetIds) => {
    const targets = targetIds?.length ? targetIds : [];
    const affected = targets.length
      ? new Set(targets.flatMap((id) => [...upstreamOf(id, edgesRef.current)]))
      : null;
    setRunning(true);
    setNodes((nds) => nds.map((n) => {
      const hit = !affected || affected.has(n.id);
      if (!hit || n.type === 'textNode' || n.type === 'noteNode') return n;
      return { ...n, data: { ...n.data, status: 'running', error: null } };
    }));
    try {
      const res = await api.run({
        canvasId,
        canvas: { nodes: nodesRef.current, edges: edgesRef.current, viewport: viewportRef.current },
        nodeIds: targets,
      });
      const patches = new Map(res.patches.map((p) => [p.nodeId, p.data]));
      setNodes((nds) => nds.map((n) => {
        const p = patches.get(n.id);
        if (p) return { ...n, data: { ...n.data, ...p } };
        return n.data.status === 'running' ? { ...n, data: { ...n.data, status: null } } : n;
      }));
      const okSteps = res.steps.filter((s) => s.status === 'ok').length;
      notify(`执行完成：${okSteps} 个节点成功（${res.ms} ms）`);
    } catch (e) {
      notify(`执行失败：${e.message}`, true);
      setNodes((nds) => nds.map((n) => (n.data.status === 'running' ? { ...n, data: { ...n.data, status: 'error', error: e.message } } : n)));
    } finally {
      setRunning(false);
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

  const onDrop = useCallback(async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    try {
      const { url } = await api.upload({ name: file.name, dataUrl });
      pushHistory();
      setNodes((nds) => nds.concat({
        id: newId('n'), type: 'imageNode',
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        data: { label: file.name, prompt: '', size: '1024x1024', imageUrl: url, status: null },
      }));
    } catch (e) { notify(e.message, true); }
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

  const ctx = useMemo(() => ({
    updateNode, deleteNode, runNode: (id) => run([id]), openSnippets,
    copy: (t) => { navigator.clipboard.writeText(t || ''); notify('已复制到剪贴板'); },
  }), [updateNode, deleteNode, run, openSnippets, notify]);

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
        <button onClick={() => addNode('textNode')}>+ 文本</button>
        <button onClick={() => addNode('llmNode')}>+ 大模型</button>
        <button onClick={() => addNode('imageNode')}>+ 生图</button>
        <button onClick={() => addNode('noteNode')}>+ 备注</button>
        <div className="sep" />
        <button onClick={undo}>撤销</button>
        <button onClick={redo}>重做</button>
        <div className="spacer" />
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
          defaultViewport={viewport}
          fitView={false}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dfe3e8" />
          <Controls />
          <MiniMap pannable zoomable nodeStrokeWidth={2} style={{ background: '#fff' }} />
        </ReactFlow>

        {!nodes.length && <div className="center-hint">画布是空的 — 点上方「+ 文本 / + 大模型 / + 生图」开始，也可以直接把图片拖进来</div>}

        {menu && (
          <div className="panel" style={{ left: menu.x, right: 'auto', top: menu.y, width: 170 }}>
            <div className="panel-body">
              {[['textNode', '文本节点'], ['llmNode', '大模型节点'], ['imageNode', '图像生成节点'], ['noteNode', '备注节点']].map(([t, label]) => (
                <button key={t} onClick={() => { addNode(t, menu.flow); setMenu(null); }}>+ {label}</button>
              ))}
            </div>
          </div>
        )}

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
