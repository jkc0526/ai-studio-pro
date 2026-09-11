import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

/**
 * 漫剧生产线入口（按 LibTV/OiiOii 截图复刻）
 *  ① 剧本（左侧大纲/类型/时长/基调/序章）→ ② 脚本生成器（右侧大对话框，调 LLM 生成完整脚本写回 script.content）
 *  后续：确认镜头 / 准备资产 / 合成提示词 — 留作下批
 */
export default function ProductionView() {
  const { script, updateScript, modelGroups, modelDefaults, notify, characters, reloadCharacters, styleId } = useApp();

  const [form, setForm] = useState({ title: '', outline: '', content: '' });
  useEffect(() => {
    if (!script) return;
    setForm({ title: script.title || '', outline: script.outline || '', content: script.content || '' });
  }, [script?.id]);

  const [openGen, setOpenGen] = useState(false);
  const [genPrompt, setGenPrompt] = useState('根据我上传的剧本生成一个完整的故事脚本');  const [refText, setRefText] = useState('');
  const [genModel, setGenModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [abortCtl, setAbortCtl] = useState(null);
  const [streamBuf, setStreamBuf] = useState('');

  const thinkingModels = modelGroups?.text || [];

  useEffect(() => {
    if (!genModel && thinkingModels.length) setGenModel(thinkingModels[0].id);
  }, [thinkingModels]);

  const openDialog = () => {
    setOpenGen(true);
    setStreamBuf('');
    const ref = [form.outline, form.content].filter(Boolean).join('\n\n');
    setRefText(ref);
  };
  const closeDialog = () => {
    if (busy && abortCtl) abortCtl.abort();
    setOpenGen(false);
    setBusy(false);
    setStreamBuf('');
  };

  const runGenerate = useCallback(async () => {
    if (!script) { notify('请先在「剧本」页新建一个剧本', true); return; }
    if (!genPrompt.trim()) { notify('请填写提示词', true); return; }
    setBusy(true);
    setStreamBuf('');
    const ctl = new AbortController();
    setAbortCtl(ctl);
    try {
      const composed = [
        genPrompt.trim(),
        refText.trim() && `\n\n【参考资料】\n${refText.trim()}`,
      ].filter(Boolean).join('');
      const res = await fetch(`/api/scripts/${script.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: composed,
          modelId: genModel || modelDefaults?.text || undefined,
        }),
        signal: ctl.signal,
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || '生成失败');
      const text = (j.data?.text || '').trim();
      if (!text) throw new Error('模型未返回正文');
      setStreamBuf(text);
      await updateScript({ ...form, content: text });
      notify(`脚本已生成（${text.length} 字），已写入剧本正文`);
      setOpenGen(false);
    } catch (e) {
      if (e.name === 'AbortError') notify('已取消生成');
      else notify(`生成失败：${e.message}`, true);
    } finally {
      setBusy(false);
      setAbortCtl(null);
    }
  }, [script, genPrompt, refText, genModel, modelDefaults, form, updateScript, notify]);

  /* ---- ② 分镜表（截图 4/7/8） ---- */
  const [shots, setShots] = useState([]);
  const [selectedShots, setSelectedShots] = useState(new Set());
  const [shotBusy, setShotBusy] = useState(''); // '' | 'split' | 'image' | 'compose'
  const [splitCount, setSplitCount] = useState(6);
  const [imgModel, setImgModel] = useState('');

  /* ---- ②-A 资产链：场景（人物来自全局 characters） ---- */
  const [scenes, setScenes] = useState([]);
  const [assetBusy, setAssetBusy] = useState(''); // '' | 'chars' | 'scenes' | 'sheet:x' | 'sceneimg:x'

  const reloadScenes = useCallback(async (sid) => {
    if (!sid) { setScenes([]); return; }
    try { setScenes(await api.listScenes(sid)); } catch { setScenes([]); }
  }, []);

  useEffect(() => {
    if (!script) return;
    reloadScenes(script.id);
    api.listShots(script.id).then(setShots).catch(() => setShots([]));
  }, [script?.id, reloadScenes]);

  const extractChars = async () => {
    if (!script) return;
    setAssetBusy('chars');
    try {
      const r = await api.extractCharacters(script.id, { modelId: modelDefaults?.text || undefined });
      await reloadCharacters();
      notify(`已提取 ${r.created} 个角色${r.skipped ? `（跳过 ${r.skipped} 个已存在）` : ''}`);
    } catch (e) { notify(`提取人物失败：${e.message}`, true); }
    finally { setAssetBusy(''); }
  };

  const extractScenes = async () => {
    if (!script) return;
    setAssetBusy('scenes');
    try {
      const r = await api.extractScenes(script.id, { modelId: modelDefaults?.text || undefined });
      setScenes(r.scenes || await api.listScenes(script.id));
      notify(`已提取 ${r.created} 个场景${r.skipped ? `（跳过 ${r.skipped} 个已存在）` : ''}`);
    } catch (e) { notify(`提取场景失败：${e.message}`, true); }
    finally { setAssetBusy(''); }
  };

  const genCharSheet = async (c) => {
    setAssetBusy(`sheet:${c.id}`);
    try {
      await api.characterSheet(c.id, { styleId: styleId || undefined, modelId: imgModel || undefined });
      await reloadCharacters();
      notify(`已生成「${c.name}」角色定妆图`);
    } catch (e) { notify(`角色出图失败：${e.message}`, true); }
    finally { setAssetBusy(''); }
  };

  const genSceneImage = async (s) => {
    setAssetBusy(`sceneimg:${s.id}`);
    try {
      const r = await api.sceneImage(s.id, { styleId: styleId || undefined, modelId: imgModel || undefined });
      setScenes((list) => list.map((x) => (x.id === s.id ? { ...x, ref_image_url: r.ref_image_url } : x)));
      notify(`已生成场景图「${s.name}」`);
    } catch (e) { notify(`场景出图失败：${e.message}`, true); }
    finally { setAssetBusy(''); }
  };

  const addScene = async () => {
    if (!script) return;
    try {
      const s = await api.createScene({ scriptId: script.id, name: `场景 ${scenes.length + 1}` });
      setScenes((list) => [...list, s]);
    } catch (e) { notify(`新建场景失败：${e.message}`, true); }
  };

  const patchScene = async (id, patch) => {
    setScenes((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    try { await api.updateScene(id, patch); } catch (e) { notify(`保存失败：${e.message}`, true); }
  };

  const removeScene = async (s) => {
    if (!window.confirm(`删除场景「${s.name}」？引用它的分镜会解除引用。`)) return;
    try {
      await api.deleteScene(s.id);
      setScenes((list) => list.filter((x) => x.id !== s.id));
      setShots((list) => list.map((x) => (x.scene_id === s.id ? { ...x, scene_id: null } : x)));
    } catch (e) { notify(`删除失败：${e.message}`, true); }
  };

  const toggleShot = (id) => {
    setSelectedShots((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedShots((prev) => (prev.size === shots.length ? new Set() : new Set(shots.map((s) => s.id))));
  };
  const patchShot = async (id, patch) => {
    setShots((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    try { await api.updateShot(id, patch); } catch (e) { notify(`保存失败：${e.message}`, true); }
  };

  const splitShots = async () => {
    if (!(form.content || '').trim()) { notify('剧本正文为空，先在脚本生成器里生成脚本', true); return; }
    setShotBusy('split');
    try {
      const r = await api.splitShots(script.id, { count: splitCount, modelId: modelDefaults?.text || undefined });
      setShots(r.shots || await api.listShots(script.id));
      notify(`已拆分 ${r.created} 个镜头`);
    } catch (e) { notify(`拆分失败：${e.message}`, true); }
    finally { setShotBusy(''); }
  };

  const batchImages = async () => {
    const ids = selectedShots.size ? [...selectedShots] : shots.map((s) => s.id);
    if (!ids.length) { notify('没有可生成的镜头', true); return; }
    setShotBusy('image');
    try {
      // 逐镜调用 /api/shots/:id/image（复用后端单镜出图，自动写回 image_url + prompt_used）
      let done = 0;
      for (const id of ids) {
        try {
          const r = await api.shotImage(id, { modelId: imgModel || undefined });
          setShots((list) => list.map((s) => (s.id === id ? { ...s, image_url: r.image_url, status: 'done' } : s)));
          done++;
        } catch (e) { notify(`镜头出图失败：${e.message}`, true); }
      }
      notify(`批量出图完成 ${done}/${ids.length}`);
    } finally { setShotBusy(''); }
  };

  const composePrompts = async () => {
    const ids = selectedShots.size ? [...selectedShots] : shots.map((s) => s.id);
    if (!ids.length) { notify('没有可合成的镜头', true); return; }
    setShotBusy('compose');
    try {
      const r = await api.composeShots(script.id, { shotIds: ids, modelId: modelDefaults?.text || undefined });
      const byId = Object.fromEntries((r.shots || []).map((s) => [s.id, s.prompt]));
      setShots((list) => list.map((s) => (byId[s.id] ? { ...s, prompt_used: byId[s.id] } : s)));
      notify(`已合成 ${r.composed} 条最终提示词`);
    } catch (e) { notify(`合成失败：${e.message}`, true); }
    finally { setShotBusy(''); }
  };

  const allSelected = shots.length > 0 && selectedShots.size === shots.length;

  if (!script) {
    return (
      <div className="view-body center">
        <div className="empty-card">
          <h3>还没有剧本</h3>
          <p className="hint">先在「剧本」页新建一个剧本，再回到这里生成完整脚本。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-body production">
      {/* 顶部步骤：资产链流程（剧本 → 人物/场景 → 分镜 → 批量） */}
      <div className="prod-steps">
        <div className="prod-step done"><span className="num">1</span><span className="label">输入剧本</span></div>
        <div className="prod-line" />
        <div className={`prod-step ${characters.length || scenes.length ? 'done' : 'active'}`}><span className="num">2</span><span className="label">提取人物 / 场景</span></div>
        <div className="prod-line" />
        <div className={`prod-step ${shots.length ? 'done' : (characters.length || scenes.length ? 'active' : '')}`}><span className="num">3</span><span className="label">生成分镜</span></div>
        <div className="prod-line" />
        <div className="prod-step"><span className="num">4</span><span className="label">批量出图 / 视频</span></div>
      </div>

      {/* 双卡布局：左侧剧本大纲 + 右侧脚本生成器 */}
      <div className="prod-grid">
        <div className="prod-card prod-script">
          <div className="prod-card-head">
            <span className="prod-icon">▤</span><span>剧本</span>
          </div>
          <div className="prod-card-body">
            <div className="prod-outline">
              <div className="line"><b>《{form.title || '未命名剧本'}》</b></div>
              <div className="line">类型：<input className="inline-input" value={(form.outline.match(/类型：(.+)/) || [])[1] || ''}
                placeholder="如：古风/穿越/爽文"
                onChange={(e) => setForm((f) => ({ ...f, outline: syncOutline(f.outline, '类型：', e.target.value) }))} /></div>
              <div className="line">时长建议：<input className="inline-input" value={(form.outline.match(/时长建议：(.+)/) || [])[1] || ''}
                placeholder="如：60-90 秒"
                onChange={(e) => setForm((f) => ({ ...f, outline: syncOutline(f.outline, '时长建议：', e.target.value) }))} /></div>
              <div className="line">基调：<input className="inline-input" value={(form.outline.match(/基调：(.+)/) || [])[1] || ''}
                placeholder="如：热血 × 重虐史诗歌"
                onChange={(e) => setForm((f) => ({ ...f, outline: syncOutline(f.outline, '基调：', e.target.value) }))} /></div>
              <div className="line"><b>【序章】</b></div>
              <textarea className="prod-outline-content" rows={3}
                value={(form.outline.match(/【序章】([\s\S]*)/) || [])[1] || ''}
                placeholder="如：现代 · 深夜办公室"
                onChange={(e) => setForm((f) => ({ ...f, outline: syncOutline(f.outline, '【序章】', e.target.value) }))} />
              <div className="hint">键击占位后，由脑腻营造抑郁、压抑呗（什、乃</div>
            </div>
          </div>
        </div>

        <div className="prod-card prod-gen" onClick={openDialog} role="button" tabIndex={0}>
          <div className="prod-card-head">
            <span className="prod-icon">▤</span><span>脚本生成器</span>
          </div>
          <div className="prod-card-body prod-gen-empty">
            <div className="prod-gen-icon">≡</div>
            <div className="hint">点击此处打开脚本生成器</div>
          </div>
        </div>
      </div>

      {/* ② 资产链：人物 + 场景（分镜的引用来源） */}
      <div className="prod-card prod-assets">
        <div className="prod-card-head">
          <span className="prod-icon">◈</span>
          <span>资产准备</span>
          <span className="pill">{characters.length} 人物 · {scenes.length} 场景</span>
          <span className="spacer" />
          <button className="ghost" onClick={extractChars} disabled={!!assetBusy}>
            {assetBusy === 'chars' ? '提取中…' : '🧑 提取人物'}
          </button>
          <button className="ghost" onClick={extractScenes} disabled={!!assetBusy}>
            {assetBusy === 'scenes' ? '提取中…' : '🏙 提取场景'}
          </button>
        </div>

        <div className="prod-asset-body">
          {/* 人物 */}
          <div className="prod-asset-sec">
            <div className="prod-asset-title">
              人物
              <span className="hint">形象锁定 · 跨镜头一致</span>
            </div>
            {!characters.length
              ? <div className="prod-asset-empty">还没有人物，点右上角「提取人物」从剧本自动识别</div>
              : (
                <div className="prod-asset-grid">
                  {characters.map((c) => (
                    <div className="prod-asset-card" key={c.id}>
                      <div className="prod-asset-thumb">
                        {c.sheet_image_url
                          ? <img src={c.sheet_image_url} alt={c.name} />
                          : <span className="prod-asset-ph">无图</span>}
                      </div>
                      <div className="prod-asset-meta">
                        <b>{c.name}</b>
                        <small>{c.role || '角色'}</small>
                      </div>
                      <button className="ghost prod-asset-btn" onClick={() => genCharSheet(c)} disabled={!!assetBusy}>
                        {assetBusy === `sheet:${c.id}` ? '生成中…' : (c.sheet_image_url ? '重绘定妆图' : '生成定妆图')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* 场景 */}
          <div className="prod-asset-sec">
            <div className="prod-asset-title">
              场景
              <span className="hint">空间锁定 · 环境/光影/氛围</span>
              <button className="ghost prod-add-btn" onClick={addScene} disabled={!!assetBusy}>＋ 新增</button>
            </div>
            {!scenes.length
              ? <div className="prod-asset-empty">还没有场景，点右上角「提取场景」从剧本自动识别</div>
              : (
                <div className="prod-asset-grid">
                  {scenes.map((s) => (
                    <div className="prod-asset-card" key={s.id}>
                      <div className="prod-asset-thumb">
                        {s.ref_image_url
                          ? <img src={s.ref_image_url} alt={s.name} />
                          : <span className="prod-asset-ph">无图</span>}
                      </div>
                      <div className="prod-asset-meta">
                        <input className="prod-asset-name" value={s.name || ''} placeholder="场景名"
                          onChange={(e) => patchScene(s.id, { name: e.target.value })} />
                        <small title={s.env}>{s.env ? `${s.env.slice(0, 24)}…` : '未设置环境'}</small>
                      </div>
                      <div className="prod-asset-actions">
                        <button className="ghost prod-asset-btn" onClick={() => genSceneImage(s)} disabled={!!assetBusy}>
                          {assetBusy === `sceneimg:${s.id}` ? '生成中…' : (s.ref_image_url ? '重绘' : '生成场景图')}
                        </button>
                        <button className="ghost prod-asset-del" onClick={() => removeScene(s)} title="删除场景">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>

      {/* ③ 分镜表（截图 4/7/8）：15 行多列 + 全选 + 批量出图 + 合成提示词 */}
      <div className="prod-card prod-shots">
        <div className="prod-card-head">
          <span className="prod-icon">▦</span>
          <span>分镜表</span>
          <span className="pill">{shots.length} 镜</span>
          <span className="spacer" />
          <button className="ghost" onClick={splitShots} disabled={!!shotBusy}>
            {shotBusy === 'split' ? '拆分中…' : '🔀 从剧本拆分'}
          </button>
          <input type="number" className="prod-count" min={2} max={30} value={splitCount}
            onChange={(e) => setSplitCount(Number(e.target.value))} title="拆分镜头数" />
        </div>

        <div className="prod-toolbar">
          <label className="prod-check">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>全选</span>
          </label>
          <span className="spacer" />
          <span className="hint">{selectedShots.size ? `已选 ${selectedShots.size} 镜` : '未勾选时默认全部'}</span>
          <select className="nodrag prod-model" value={imgModel} onChange={(e) => setImgModel(e.target.value)}>
            <option value="">默认图像模型</option>
            {(modelGroups?.image || []).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
          <button className="ghost" onClick={batchImages} disabled={!!shotBusy}>
            {shotBusy === 'image' ? '出图中…' : '🎨 批量出图'}
          </button>
          <button className="ghost" onClick={composePrompts} disabled={!!shotBusy} title="调 LLM 把剧本+分镜重组成完整提示词">
            {shotBusy === 'compose' ? '合成中…' : '✨ 智能合成提示词'}
          </button>
        </div>

        {!shots.length ? (
          <div className="prod-card-body prod-empty">
            <p className="hint">还没有分镜。先在右侧「脚本生成器」生成脚本，再点「从剧本拆分」。</p>
          </div>
        ) : (
          <div className="prod-shot-table">
            <table>
              <thead>
                <tr>
                  <th className="col-check"></th>
                  <th className="col-seq">#</th>
                  <th>画面描述</th>
                  <th className="col-ref">场景</th>
                  <th className="col-ref">人物</th>
                  <th>运镜 / 景别</th>
                  <th>对白 / 旁白</th>
                  <th className="col-dur">时长</th>
                  <th className="col-status">状态</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((s) => (
                  <tr key={s.id} className={selectedShots.has(s.id) ? 'on' : ''}>
                    <td className="col-check">
                      <input type="checkbox" checked={selectedShots.has(s.id)} onChange={() => toggleShot(s.id)} />
                    </td>
                    <td className="col-seq">{s.seq}</td>
                    <td>
                      <textarea rows={2} value={s.scene || ''} placeholder="画面描述"
                        onChange={(e) => patchShot(s.id, { scene: e.target.value })} />
                    </td>
                    <td className="col-ref">
                      <select value={s.scene_id || ''} onChange={(e) => patchShot(s.id, { sceneId: e.target.value || null })}>
                        <option value="">未指定</option>
                        {scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                      </select>
                    </td>
                    <td className="col-ref">
                      <div className="prod-cast">
                        {(s.character_ids ? JSON.parse(s.character_ids || '[]') : [])
                          .map((cid) => characters.find((c) => c.id === cid)?.name || cid)
                          .map((name) => <span key={name} className="prod-cast-chip">{name}</span>)}
                      </div>
                    </td>
                    <td>
                      <input value={s.camera || ''} placeholder="如：中景，缓慢推近"
                        onChange={(e) => patchShot(s.id, { camera: e.target.value })} />
                    </td>
                    <td>
                      <input value={s.dialogue || ''} placeholder="台词 / 旁白"
                        onChange={(e) => patchShot(s.id, { dialogue: e.target.value })} />
                    </td>
                    <td className="col-dur">
                      <input type="number" min={1} max={20} value={s.duration || 5}
                        onChange={(e) => patchShot(s.id, { duration: Number(e.target.value) })} />
                    </td>
                    <td className="col-status">
                      {s.image_url
                        ? <span className="badge done">已出图</span>
                        : s.status === 'error' ? <span className="badge error">失败</span>
                        : <span className="badge">待生成</span>}
                      {s.prompt_used && <span className="hint" title={s.prompt_used}>✓提示词</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openGen && (
        <div className="prod-dialog-mask" onClick={(e) => { if (e.target === e.currentTarget && !busy) closeDialog(); }}>
          <div className="prod-dialog">
            <div className="prod-dialog-head">
              <span>脚本生成器 · 《{form.title || '未命名剧本'}》</span>
              <button className="ghost prod-close" onClick={closeDialog} disabled={busy}>×</button>
            </div>
            <div className="prod-dialog-body">
              <div className="prod-row">
                <button className="ghost" disabled={busy}>＋ 参考图</button>
                <span className="spacer" />
                <button className="ghost" onClick={() => setRefText('')} disabled={busy}>清空参考</button>
              </div>
              <div className="prod-attachments">
                <div className="prod-att prod-att-active">
                  <span className="prod-att-num">1</span><span>≡</span>
                </div>
              </div>
              <textarea className="prod-prompt" rows={3} value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                placeholder="告诉模型你想要什么样的脚本…" disabled={busy} />
              {refText && (
                <details className="prod-ref" open>
                  <summary>参考资料（剧本大纲 / 正文，{refText.length} 字）</summary>
                  <textarea rows={5} value={refText} onChange={(e) => setRefText(e.target.value)} disabled={busy} />
                </details>
              )}
              {busy && (
                <div className="prod-streaming">
                  <div className="prod-streaming-label">模型生成中…</div>
                  <pre>{streamBuf || ' '}</pre>
                </div>
              )}
            </div>
            <div className="prod-dialog-foot">
              <select className="nodrag" value={genModel} onChange={(e) => setGenModel(e.target.value)} disabled={busy}>
                <option value="">默认模型</option>
                {thinkingModels.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
              </select>
              <span className="prod-cost">⚡ 1</span>
              <span className="spacer" />
              {busy
                ? <button className="primary" onClick={() => { if (abortCtl) abortCtl.abort(); }}>停止</button>
                : <button className="primary prod-send" onClick={runGenerate}>↑ 生成</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function syncOutline(text, key, value) {
  const lines = String(text || '').split('\n').filter(Boolean);
  const filtered = lines.filter((l) => !l.startsWith(key));
  if (value) filtered.push(`${key}${value}`);
  return filtered.join('\n');
}