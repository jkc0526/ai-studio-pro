import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const PURPOSES = [
  { key: 'thinking', title: '文本模型', desc: '拆分镜 / 角色提取 / 大模型节点' },
  { key: 'image_gen', title: '图像模型', desc: '分镜图 / 角色三视图' },
  { key: 'video', title: '视频模型', desc: '图生视频 / 批量视频' },
];
const STEPS = { source: '用途', provider: '供应商', custom: '自定义接口' };
const BLANK_API = {
  name: '', kind: 'image', method: 'POST', url_template: '{{base_url}}/images/generations',
  headers_json: '{}',
  body_template: '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "size": "{{size}}"\n}',
  response_path: 'data.0.url', result_type: 'auto', text_path: '',
  poll_url_template: '', poll_interval: 5000, poll_max: 120,
  poll_status_path: 'status', poll_done_values: 'completed,success', poll_fail_values: 'failed,error',
  poll_result_path: '', notes: '',
};

export default function SettingsModal({ open, onClose, notify }) {
  const [tab, setTab] = useState('source');
  const [configs, setConfigs] = useState({});
  const [providers, setProviders] = useState([]);
  const [customs, setCustoms] = useState([]);
  const [protocols, setProtocols] = useState([]);
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState({});
  const [editing, setEditing] = useState(null);
  const [editingApi, setEditingApi] = useState(null);
  const [apiTry, setApiTry] = useState(null);
  const [modelList, setModelList] = useState(null);

  const load = useCallback(async () => {
    const [cfg, pv, ca, pr] = await Promise.all([
      api.getAiConfig(), api.listProviders(), api.listCustomApis(), api.protocols(),
    ]);
    const map = {};
    for (const p of PURPOSES) {
      const c = cfg.find((x) => x.purpose === p.key) || {};
      map[p.key] = {
        base_url: c.base_url || '', model_id: c.model_id || '', api_key: '',
        key_hint: c.key_hint || '', has_key: !!c.has_key, clear: false,
        provider_id: c.provider_id || '', custom_api_id: c.custom_api_id || '',
        provider_name: c.provider_name, custom_api_name: c.custom_api_name,
      };
    }
    setConfigs(map);
    setProviders(pv);
    setCustoms(ca);
    setProtocols(pr);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTestResult({}); setModelList(null);
    load().catch((e) => notify(e.message, true));
  }, [open, load, notify]);

  if (!open) return null;

  const patch = (purpose, p) => setConfigs((f) => ({ ...f, [purpose]: { ...(f[purpose] || {}), ...p } }));

  const saveAll = async () => {
    setBusy('save');
    try {
      for (const p of PURPOSES) {
        const f = configs[p.key];
        if (!f) continue;
        await api.saveAiConfig(p.key, {
          base_url: f.base_url, model_id: f.model_id,
          provider_id: f.custom_api_id ? null : (f.provider_id || null),
          custom_api_id: f.custom_api_id || null,
          ...(f.clear ? { clear_key: true } : { api_key: f.api_key }),
        });
      }
      await load();
      notify('配置已保存（文本 / 图像 / 视频）');
      onClose();
    } catch (e) { notify(`保存失败：${e.message}`, true); } finally { setBusy(''); }
  };

  const test = async (purpose) => {
    const f = configs[purpose];
    setBusy(`test:${purpose}`);
    setTestResult((t) => ({ ...t, [purpose]: null }));
    try {
      const r = await api.testAiConfig(purpose, {
        base_url: f.base_url, model_id: f.model_id, api_key: f.api_key,
        provider_id: f.provider_id || undefined, custom_api_id: f.custom_api_id || undefined,
      });
      setTestResult((t) => ({ ...t, [purpose]: { ok: true, text: r.detail } }));
    } catch (e) {
      setTestResult((t) => ({ ...t, [purpose]: { ok: false, text: e.message } }));
    } finally { setBusy(''); }
  };

  const loadModels = async (purpose) => {
    const f = configs[purpose];
    setBusy(`models:${purpose}`);
    try {
      const qs = new URLSearchParams({ purpose });
      if (f.provider_id && !f.custom_api_id) qs.set('providerId', f.provider_id);
      const r = await api.listModels(qs.toString());
      setModelList({ purpose, ...r });
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const saveProvider = async () => {
    if (!editing?.name) return notify('请填写供应商名称', true);
    setBusy('pv');
    try {
      const payload = {
        name: editing.name, protocol: editing.protocol, base_url: editing.base_url,
        notes: editing.notes, api_key: editing.api_key, clear_key: editing.clear,
      };
      if (editing.id) await api.updateProvider(editing.id, payload);
      else await api.createProvider(payload);
      setEditing(null);
      await load();
      notify('供应商已保存');
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const removeProvider = async (p) => {
    if (!window.confirm(`删除供应商「${p.name}」？引用它的用途会回退到直填配置。`)) return;
    await api.deleteProvider(p.id);
    await load();
    notify('供应商已删除');
  };

  const saveApi = async () => {
    if (!editingApi?.name || !editingApi?.url_template) return notify('名称和 URL 模板必填', true);
    setBusy('ca');
    try {
      const { id, ...body } = editingApi;
      if (id) await api.updateCustomApi(id, body);
      else await api.createCustomApi(body);
      setEditingApi(null);
      await load();
      notify('自定义接口已保存');
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const tryApi = async (row) => {
    setBusy('try');
    setApiTry({ loading: true });
    const f = configs[row.kind === 'text' ? 'thinking' : row.kind === 'video' ? 'video' : 'image_gen'] || {};
    try {
      const r = await api.tryCustomApi(row.id, {
        api_key: f.api_key || undefined, base_url: f.base_url || undefined, model: f.model_id || undefined,
      });
      setApiTry({ ok: true, ...r });
      notify(`试跑成功（${r.ms} ms）`);
    } catch (e) {
      setApiTry({ ok: false, text: e.message });
      notify(e.message, true);
    } finally { setBusy(''); }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>模型与接口设置</span>
          <button className="ghost" onClick={onClose}>×</button>
        </div>

        <div className="modal-body scroll">
          <div className="tabs">
            {Object.entries(STEPS).map(([k, label]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
            <span className="hint" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              优先级：自定义接口 &gt; 供应商 &gt; 直填地址
            </span>
          </div>

          {tab === 'source' && PURPOSES.map((p) => {
            const f = configs[p.key] || {};
            const tr = testResult[p.key];
            return (
              <div className="config-card" key={p.key}>
                <div className="config-head">
                  <b>{p.title}</b>
                  <span className="hint">{p.desc}</span>
                  <span className="spacer" />
                  <span className={`keytag ${f.has_key || f.provider_id ? 'ok' : ''}`}>
                    来源：{f.custom_api_name || f.provider_name || '直填地址'}
                  </span>
                </div>

                <div className="row3">
                  <div className="field">
                    <label className="field-label">来源</label>
                    <select
                      value={f.custom_api_id ? `ca:${f.custom_api_id}` : f.provider_id ? `pv:${f.provider_id}` : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v.startsWith('ca:')) patch(p.key, { custom_api_id: v.slice(3), provider_id: '' });
                        else if (v.startsWith('pv:')) {
                          const pv = providers.find((x) => x.id === v.slice(3));
                          patch(p.key, { provider_id: v.slice(3), custom_api_id: '', base_url: pv?.base_url || f.base_url });
                        } else patch(p.key, { provider_id: '', custom_api_id: '' });
                      }}
                    >
                      <option value="">直填 Base URL / Key</option>
                      <optgroup label="供应商">
                        {providers.map((pv) => <option key={pv.id} value={`pv:${pv.id}`}>{pv.name}{pv.has_key ? '' : '（未填 Key）'}</option>)}
                      </optgroup>
                      <optgroup label="自定义接口">
                        {customs.map((ca) => <option key={ca.id} value={`ca:${ca.id}`}>{ca.name}（{ca.kind}）</option>)}
                      </optgroup>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">模型名</label>
                    <input value={f.model_id || ''}
                      placeholder={p.key === 'thinking' ? 'gpt-4o-mini' : p.key === 'image_gen' ? 'gpt-image-1' : 'sora-2'}
                      onChange={(e) => patch(p.key, { model_id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label">操作</label>
                    <div className="snippet-actions">
                      <button onClick={() => loadModels(p.key)} disabled={!!busy}>{busy === `models:${p.key}` ? '拉取中…' : '拉取模型'}</button>
                      <button onClick={() => test(p.key)} disabled={!!busy}>{busy === `test:${p.key}` ? '测试中…' : '测试连接'}</button>
                    </div>
                  </div>
                </div>

                {!f.custom_api_id && (
                  <div className="row3">
                    <div className="field">
                      <label className="field-label">Base URL</label>
                      <input value={f.base_url || ''} placeholder="https://api.example.com/v1"
                        onChange={(e) => patch(p.key, { base_url: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="field-label">
                        API Key
                        {f.has_key && <span className="keytag ok" style={{ marginLeft: 6 }}>已保存 {f.key_hint}</span>}
                        {f.has_key && !f.clear && (
                          <button className="ghost tiny" style={{ marginLeft: 6 }}
                            onClick={() => patch(p.key, { clear: true, api_key: '', has_key: false })}>清除</button>
                        )}
                        {f.clear && <button className="ghost tiny" style={{ marginLeft: 6 }} onClick={() => patch(p.key, { clear: false })}>取消清除</button>}
                      </label>
                      <input type="text" autoComplete="off" spellCheck={false} value={f.api_key || ''} disabled={f.clear}
                        placeholder={f.has_key ? '留空 = 不修改，粘贴新 Key 则覆盖' : '粘贴 API Key'}
                        onChange={(e) => patch(p.key, { api_key: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="field-label">来源说明</label>
                      <div className="hint" style={{ paddingTop: 6 }}>
                        {f.provider_id ? '已选供应商，Key 取自供应商' : '未选供应商时使用下面的直填地址与 Key'}
                      </div>
                    </div>
                  </div>
                )}

                {tr && <div className={tr.ok ? 'err-box ok' : 'err-box'}>{tr.ok ? '✓ ' : '✕ '}{tr.text}</div>}
                {modelList?.purpose === p.key && (
                  <div className="model-picker">
                    <div className="snippet-actions">
                      <button className="tiny" disabled={busy === `probe:${p.key}`}
                        onClick={async () => {
                          setBusy(`probe:${p.key}`);
                          try {
                            const kind = p.key === 'image_gen' ? 'image' : p.key === 'video' ? 'video' : 'text';
                            const r = await api.probeModels({ kind, purpose: p.key, models: modelList.list || [] });
                            setModelList((m) => ({ ...m, probe: r.results || {} }));
                            const ok = Object.values(r.results || {}).filter((x) => x.state === 'ok').length;
                            notify(`检测完成：${ok} 个可用`);
                          } catch (e) { notify(e.message, true); } finally { setBusy(''); }
                        }}>
                        {busy === `probe:${p.key}` ? '检测中…' : '检测可用性（不消耗额度）'}
                      </button>
                      <span className="hint">
                        共 {modelList.list?.length || 0} 个{modelList.blocked?.length ? ` · 网关标注受限 ${modelList.blocked.length} 个` : ''}
                        {modelList.source ? ` · 来源：${modelList.source}` : ''}
                      </span>
                    </div>
                    <div className="model-chips">
                      {(modelList.list || []).map((m) => {
                        const pr = modelList.probe?.[m];
                        const mark = pr ? (pr.state === 'ok' ? '✓' : pr.state === 'limited' ? '⏳' : '✕') : '';
                        return (
                          <button key={m} className={`chip ${f.model_id === m ? 'on' : ''}`} title={pr?.detail || ''}
                            onClick={() => patch(p.key, { model_id: m })}>
                            {mark && <b style={{ color: pr.state === 'ok' ? 'var(--ok)' : pr.state === 'limited' ? 'var(--warn)' : 'var(--err)' }}>{mark} </b>}
                            {m}
                          </button>
                        );
                      })}
                    </div>
                    {!!modelList.blocked?.length && (
                      <div className="hint">网关 403 中提示受限：{modelList.blocked.join('、')}（注意：该列表按端点给出，未必准确，以「检测可用性」结果为准）</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {tab === 'provider' && (
            <>
              <div className="snippet-actions">
                <button className="primary" onClick={() => setEditing({ name: '', protocol: 'openai', base_url: '', api_key: '', notes: '' })}>+ 新建供应商</button>
                <span className="hint">已内置常见网关，选中后只需填 Key</span>
              </div>

              <div className="pv-grid">
                {providers.map((p) => (
                  <div className="pv-card" key={p.id}>
                    <div className="pv-title">
                      <b>{p.name}</b>
                      <span className="keytag">{protocols.find((x) => x.key === p.protocol)?.name || p.protocol}</span>
                    </div>
                    <div className="hint">{p.base_url}</div>
                    {p.notes && <div className="hint">{p.notes}</div>}
                    <div className="pv-foot">
                      <span className={`keytag ${p.has_key ? 'ok' : ''}`}>{p.has_key ? `已存 ${p.key_hint}` : '未填 Key'}</span>
                      <span className="spacer" />
                      <button className="tiny" onClick={() => setEditing({ ...p, api_key: '', clear: false })}>编辑</button>
                      <button className="ghost tiny" onClick={() => removeProvider(p)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>

              {editing && (
                <div className="config-card">
                  <div className="config-head"><b>{editing.id ? '编辑供应商' : '新建供应商'}</b></div>
                  <div className="row3">
                    <div className="field"><label className="field-label">名称</label>
                      <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                    <div className="field"><label className="field-label">协议</label>
                      <select value={editing.protocol} onChange={(e) => setEditing({ ...editing, protocol: e.target.value })}>
                        {protocols.map((pr) => <option key={pr.key} value={pr.key}>{pr.name}</option>)}
                      </select></div>
                    <div className="field"><label className="field-label">Base URL</label>
                      <input value={editing.base_url} onChange={(e) => setEditing({ ...editing, base_url: e.target.value })} /></div>
                  </div>
                  <div className="row3">
                    <div className="field">
                      <label className="field-label">API Key {editing.has_key && <span className="keytag ok" style={{ marginLeft: 6 }}>已存 {editing.key_hint}</span>}</label>
                      <input value={editing.api_key || ''} placeholder={editing.has_key ? '留空 = 不修改' : '粘贴 Key'}
                        onChange={(e) => setEditing({ ...editing, api_key: e.target.value })} />
                    </div>
                    <div className="field" style={{ gridColumn: 'span 2' }}>
                      <label className="field-label">备注</label>
                      <input value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                    </div>
                  </div>
                  <div className="snippet-actions">
                    <button className="primary" onClick={saveProvider} disabled={busy === 'pv'}>保存</button>
                    <button onClick={() => setEditing(null)}>取消</button>
                    <span className="hint">{protocols.find((x) => x.key === editing.protocol)?.hint}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'custom' && (
            <>
              <div className="snippet-actions">
                <button className="primary" onClick={() => setEditingApi({ ...BLANK_API, name: `我的接口 ${customs.length + 1}` })}>+ 新建自定义接口</button>
                <span className="hint">任何 REST 接口都能接：占位符注入参数、字段路径取结果、支持异步轮询</span>
              </div>

              <div className="pv-grid">
                {customs.map((c) => (
                  <div className="pv-card" key={c.id}>
                    <div className="pv-title"><b>{c.name}</b><span className="keytag">{c.kind}</span></div>
                    <div className="hint">{c.method} {c.url_template}</div>
                    <div className="hint">取值：{c.text_path || c.response_path || '自动识别'}{c.poll_url_template ? ' · 带轮询' : ''}</div>
                    <div className="pv-foot">
                      <button className="tiny" onClick={() => tryApi(c)} disabled={busy === 'try'}>试跑</button>
                      <button className="tiny" onClick={() => setEditingApi({ ...c })}>编辑</button>
                      <span className="spacer" />
                      <button className="ghost tiny" onClick={async () => { if (window.confirm(`删除接口「${c.name}」？`)) { await api.deleteCustomApi(c.id); await load(); } }}>删除</button>
                    </div>
                  </div>
                ))}
              </div>

              {apiTry && (
                <div className={apiTry.ok ? 'err-box ok' : 'err-box'}>
                  {apiTry.loading ? '试跑中…' : apiTry.ok
                    ? `✓ ${apiTry.ms} ms${apiTry.polls ? ` · 轮询 ${apiTry.polls} 次` : ''}${apiTry.text ? ` · 文本：${String(apiTry.text).slice(0, 60)}` : ''}${apiTry.url ? ` · 产物：${apiTry.url}` : ''}`
                    : `✕ ${apiTry.text}`}
                  {apiTry.ok && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      请求：{apiTry.request?.method} {apiTry.request?.url}<br />
                      响应摘要：{String(apiTry.raw || '').slice(0, 260)}
                    </div>
                  )}
                </div>
              )}

              {editingApi && (
                <div className="config-card">
                  <div className="config-head"><b>{editingApi.id ? '编辑自定义接口' : '新建自定义接口'}</b></div>
                  <div className="row3">
                    <div className="field"><label className="field-label">名称</label>
                      <input value={editingApi.name} onChange={(e) => setEditingApi({ ...editingApi, name: e.target.value })} /></div>
                    <div className="field"><label className="field-label">类型</label>
                      <select value={editingApi.kind} onChange={(e) => setEditingApi({ ...editingApi, kind: e.target.value })}>
                        <option value="text">文本</option><option value="image">图像</option><option value="video">视频</option>
                      </select></div>
                    <div className="field"><label className="field-label">方法</label>
                      <select value={editingApi.method} onChange={(e) => setEditingApi({ ...editingApi, method: e.target.value })}>
                        <option>POST</option><option>GET</option>
                      </select></div>
                  </div>

                  <div className="field"><label className="field-label">URL 模板</label>
                    <input value={editingApi.url_template}
                      placeholder="https://api.example.com/v1/images/generations 或 {{base_url}}/xxx"
                      onChange={(e) => setEditingApi({ ...editingApi, url_template: e.target.value })} /></div>

                  <div className="row3">
                    <div className="field"><label className="field-label">请求头 JSON</label>
                      <textarea rows={3} value={editingApi.headers_json} onChange={(e) => setEditingApi({ ...editingApi, headers_json: e.target.value })} /></div>
                    <div className="field" style={{ gridColumn: 'span 2' }}>
                      <label className="field-label">请求体模板（JSON）</label>
                      <textarea rows={3} value={editingApi.body_template} onChange={(e) => setEditingApi({ ...editingApi, body_template: e.target.value })} />
                    </div>
                  </div>

                  <div className="hint">
                    占位符：{'{{prompt}} {{image}} {{model}} {{size}} {{duration}} {{system}} {{user}} {{max_tokens}} {{base_url}} {{api_key}} {{id}}(轮询)'}
                  </div>

                  <div className="row3">
                    <div className="field"><label className="field-label">文本字段路径</label>
                      <input value={editingApi.text_path || ''} placeholder="choices.0.message.content"
                        onChange={(e) => setEditingApi({ ...editingApi, text_path: e.target.value })} /></div>
                    <div className="field"><label className="field-label">结果字段路径</label>
                      <input value={editingApi.response_path || ''} placeholder="data.0.url，留空自动识别"
                        onChange={(e) => setEditingApi({ ...editingApi, response_path: e.target.value })} /></div>
                    <div className="field"><label className="field-label">结果类型</label>
                      <select value={editingApi.result_type} onChange={(e) => setEditingApi({ ...editingApi, result_type: e.target.value })}>
                        <option value="auto">自动（链接 / base64）</option>
                        <option value="url">固定链接</option>
                        <option value="b64">固定 base64</option>
                      </select></div>
                  </div>

                  <details className="adv">
                    <summary>异步任务轮询（可选）</summary>
                    <div className="row3">
                      <div className="field"><label className="field-label">轮询 URL 模板</label>
                        <input value={editingApi.poll_url_template || ''} placeholder="https://api.example.com/v1/tasks/{{id}}"
                          onChange={(e) => setEditingApi({ ...editingApi, poll_url_template: e.target.value })} /></div>
                      <div className="field"><label className="field-label">间隔(ms)</label>
                        <input type="number" value={editingApi.poll_interval} onChange={(e) => setEditingApi({ ...editingApi, poll_interval: Number(e.target.value) })} /></div>
                      <div className="field"><label className="field-label">最大次数</label>
                        <input type="number" value={editingApi.poll_max} onChange={(e) => setEditingApi({ ...editingApi, poll_max: Number(e.target.value) })} /></div>
                    </div>
                    <div className="row3">
                      <div className="field"><label className="field-label">状态字段路径</label>
                        <input value={editingApi.poll_status_path || ''} onChange={(e) => setEditingApi({ ...editingApi, poll_status_path: e.target.value })} /></div>
                      <div className="field"><label className="field-label">完成值（逗号分隔）</label>
                        <input value={editingApi.poll_done_values || ''} onChange={(e) => setEditingApi({ ...editingApi, poll_done_values: e.target.value })} /></div>
                      <div className="field"><label className="field-label">失败值</label>
                        <input value={editingApi.poll_fail_values || ''} onChange={(e) => setEditingApi({ ...editingApi, poll_fail_values: e.target.value })} /></div>
                    </div>
                    <div className="field"><label className="field-label">完成后结果字段路径</label>
                      <input value={editingApi.poll_result_path || ''} placeholder="url"
                        onChange={(e) => setEditingApi({ ...editingApi, poll_result_path: e.target.value })} /></div>
                  </details>

                  <div className="field"><label className="field-label">备注</label>
                    <input value={editingApi.notes || ''} onChange={(e) => setEditingApi({ ...editingApi, notes: e.target.value })} /></div>

                  <div className="snippet-actions">
                    <button className="primary" onClick={saveApi} disabled={busy === 'ca'}>保存</button>
                    <button onClick={() => setEditingApi(null)}>取消</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="hint">{providers.length} 个供应商 · {customs.length} 个自定义接口 · 密钥仅存本机</span>
          <span className="spacer" />
          <button onClick={onClose}>关闭</button>
          <button className="primary" onClick={saveAll} disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : '保存用途配置'}</button>
        </div>
      </div>
    </div>
  );
}
