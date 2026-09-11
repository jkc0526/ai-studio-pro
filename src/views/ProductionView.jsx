import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

/**
 * 漫剧生产线入口（按 LibTV/OiiOii 截图复刻）
 *  ① 剧本（左侧大纲/类型/时长/基调/序章）→ ② 脚本生成器（右侧大对话框，调 LLM 生成完整脚本写回 script.content）
 *  后续：确认镜头 / 准备资产 / 合成提示词 — 留作下批
 */
export default function ProductionView() {
  const { script, updateScript, modelGroups, modelDefaults, notify } = useApp();

  const [form, setForm] = useState({ title: '', outline: '', content: '' });
  useEffect(() => {
    if (!script) return;
    setForm({ title: script.title || '', outline: script.outline || '', content: script.content || '' });
  }, [script?.id]);

  const [openGen, setOpenGen] = useState(false);
  const [genPrompt, setGenPrompt] = useState('根据我上传的剧本生成一个完整的故事脚本');
  const [refText, setRefText] = useState('');
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
      {/* 顶部 3 步进度（截图 10 的完成态视觉） */}
      <div className="prod-steps">
        <div className="prod-step done"><span className="num">1</span><span className="label">确认剧本</span></div>
        <div className="prod-line" />
        <div className="prod-step active"><span className="num">2</span><span className="label">生成脚本</span></div>
        <div className="prod-line" />
        <div className="prod-step"><span className="num">3</span><span className="label">批量化生成</span></div>
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