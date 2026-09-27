import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context.js';

export default function ScriptGenerator({ form }) {
  const { script, updateScript, modelGroups, modelDefaults, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('根据我上传的剧本生成一个完整的故事脚本');
  const [reference, setReference] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [abortCtl, setAbortCtl] = useState(null);
  const thinkingModels = modelGroups?.text || [];

  useEffect(() => {
    if (!model && thinkingModels.length) setModel(thinkingModels[0].id || thinkingModels[0]);
  }, [model, thinkingModels]);

  const openDialog = () => {
    setReference([form.outline, form.content].filter(Boolean).join('\n\n'));
    setResult('');
    setOpen(true);
  };

  const close = () => {
    if (busy) abortCtl?.abort();
    setOpen(false);
    setBusy(false);
  };

  const generate = useCallback(async () => {
    if (!script) return notify('请先创建项目', true);
    if (!prompt.trim()) return notify('请填写生成要求', true);
    setBusy(true);
    setResult('');
    const ctl = new AbortController();
    setAbortCtl(ctl);
    try {
      const composed = [prompt.trim(), reference.trim() && `\n\n【参考资料】\n${reference.trim()}`].filter(Boolean).join('');
      const res = await fetch(`/api/scripts/${script.id}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: composed, modelId: model || modelDefaults?.text || undefined }), signal: ctl.signal,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '生成失败');
      const text = (data.data?.text || '').trim();
      if (!text) throw new Error('模型未返回正文');
      setResult(text);
      await updateScript({ ...form, content: text });
      notify(`脚本已生成（${text.length} 字），已写入剧本正文`);
      setOpen(false);
    } catch (e) {
      if (e.name === 'AbortError') notify('已取消生成');
      else notify(`生成失败：${e.message}`, true);
    } finally { setBusy(false); setAbortCtl(null); }
  }, [script, prompt, reference, model, modelDefaults, form, updateScript, notify]);

  return (
    <>
      <button onClick={openDialog} title="根据梗概和参考资料生成剧本">脚本生成器</button>
      {open && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
          <div className="modal wide script-generator">
            <div className="modal-head"><span>脚本生成器 · {script?.title || '当前项目'}</span><button className="ghost" onClick={close} disabled={busy}>×</button></div>
            <div className="modal-body scroll">
              <div className="field"><label className="field-label">生成要求</label><textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} placeholder="告诉模型故事类型、节奏、人物关系和结尾悬念" /></div>
              <details className="adv" open><summary>参考资料</summary><textarea rows={8} value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} placeholder="项目梗概或已有正文会自动带入，也可以在这里修改" /></details>
              {busy && <div className="config-card"><span className="hint">模型生成中…</span>{result && <pre className="out-box">{result}</pre>}</div>}
            </div>
            <div className="modal-foot"><select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}><option value="">使用默认模型</option>{thinkingModels.map((m) => <option key={m.id || m} value={m.id || m}>{m.label || m.id || m}</option>)}</select><span className="spacer" />{busy ? <button className="primary" onClick={() => abortCtl?.abort()}>停止</button> : <button className="primary" onClick={generate}>生成并写入剧本</button>}</div>
          </div>
        </div>
      )}
    </>
  );
}
