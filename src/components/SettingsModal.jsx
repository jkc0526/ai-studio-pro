import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const PURPOSES = [
  { key: 'thinking', title: '文本模型', desc: '剧本 / 分镜拆解 / AI 助手' },
  { key: 'image_gen', title: '图片模型', desc: '分镜图 / 角色与场景素材' },
  { key: 'video', title: '视频模型', desc: '图生视频 / 批量视频' },
];
const MODEL_CATEGORIES = [
  ...PURPOSES.map(({ key, title }) => ({ key, title })),
  { key: 'audio', title: '音频模型', disabled: true },
];
const BLANK_API = {
  name: '', kind: 'image', method: 'POST', url_template: '{{base_url}}/images/generations',
  headers_json: '{}',
  body_template: '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "size": "{{size}}"\n}',
  response_path: 'data.0.url', result_type: 'auto', text_path: '',
  poll_url_template: '', poll_interval: 5000, poll_max: 120,
  poll_status_path: 'status', poll_done_values: 'completed,success', poll_fail_values: 'failed,error',
  poll_result_path: '', notes: '',
};

function ModelKindIcon({ kind }) {
  const shared = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (kind === 'image_gen') return <svg {...shared}><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><circle cx="9" cy="9" r="1.5" /><path d="m4.5 17 5-5 3.2 3.2 2.3-2.2 4.5 4.5" /></svg>;
  if (kind === 'video') return <svg {...shared}><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="m10 9 5 3-5 3z" /></svg>;
  return <svg {...shared}><path d="M5 6h14M5 12h14M5 18h9" /></svg>;
}

function ReleaseNotesBody({ notes }) {
  const lines = String(notes || '暂无更新说明').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return <p>暂无更新说明</p>;
  return lines.map((line, index) => {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const bullet = line.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (heading) return <strong className="update-release-subheading" key={index}>{heading[1]}</strong>;
    if (bullet) return <p className="update-release-bullet" key={index}><span aria-hidden="true">•</span>{bullet[1]}</p>;
    return <p key={index}>{line}</p>;
  });
}

function formatReleaseDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default function SettingsModal({ open, onClose, notify }) {
  const [tab, setTab] = useState('source');
  const [purposeTab, setPurposeTab] = useState('thinking');
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
  const [visibleKeys, setVisibleKeys] = useState({});
  const [visibleProviderKey, setVisibleProviderKey] = useState(false);
  const configFileRef = useRef(null);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle' });
  const [recentReleases, setRecentReleases] = useState([]);
  const [recentReleasesState, setRecentReleasesState] = useState('idle');

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
    setVisibleKeys({}); setVisibleProviderKey(false);
    setTestResult({}); setModelList(null);
    load().catch((e) => notify(e.message, true));
  }, [open, load, notify]);

  useEffect(() => {
    if (!open || !window.weaveUpdates) return undefined;
    let active = true;
    const unsubscribe = window.weaveUpdates.onStatus((status) => {
      if (active) setUpdateStatus(status);
    });
    Promise.all([window.weaveUpdates.getVersion(), window.weaveUpdates.getStatus()])
      .then(([version, status]) => {
        if (!active) return;
        setAppVersion(version);
        setUpdateStatus(status || { state: 'idle' });
      })
      .catch(() => {});
    if (typeof window.weaveUpdates.getRecentReleases === 'function') {
      setRecentReleasesState('loading');
      window.weaveUpdates.getRecentReleases()
        .then((releases) => {
          if (!active) return;
          const list = Array.isArray(releases) ? releases.slice(0, 3) : [];
          setRecentReleases(list);
          setRecentReleasesState(list.length ? 'ready' : 'empty');
        })
        .catch(() => { if (active) setRecentReleasesState('error'); });
    } else {
      setRecentReleasesState('unavailable');
    }
    return () => { active = false; unsubscribe?.(); };
  }, [open]);

  if (!open) return null;

  const patch = (purpose, p) => setConfigs((f) => ({ ...f, [purpose]: { ...(f[purpose] || {}), ...p } }));

  const updateAction = async () => {
    if (!window.weaveUpdates) {
      setUpdateStatus({ state: 'unavailable', message: '请在已安装的 Windows 桌面版中使用更新' });
      return;
    }
    try {
      if (updateStatus.state === 'downloaded') await window.weaveUpdates.install();
      else if (updateStatus.state === 'available') await window.weaveUpdates.download();
      else await window.weaveUpdates.check();
    } catch (error) {
      setUpdateStatus({ state: 'error', message: error.message || '更新操作失败' });
    }
  };

  const updateButtonText = ({
    idle: '检查更新', checking: '正在检查…', downloading: `正在下载${Number.isFinite(updateStatus.percent) ? ` ${updateStatus.percent}%` : '…'}`,
    available: updateStatus.version ? `下载更新 v${updateStatus.version}` : '下载更新',
    downloaded: '重启并安装', 'up-to-date': '已是最新版本', unavailable: '仅桌面版支持', error: '重试检查',
  }[updateStatus.state] || '检查更新');

  const updateStatusMessage = ({
    idle: '点击检查更新；发现新版本后，再点击下载。',
    checking: '正在检查是否有新版本…',
    available: `发现新版本 v${updateStatus.version || ''}，再次点击按钮开始下载。`,
    downloading: `正在下载${updateStatus.version ? ` v${updateStatus.version}` : '更新'}${Number.isFinite(updateStatus.percent) ? `（${updateStatus.percent}%）` : '…'}`,
    downloaded: `新版本${updateStatus.version ? ` v${updateStatus.version}` : ''}已下载，点击重启并安装。`,
    'up-to-date': '当前已是最新版本。',
    unavailable: updateStatus.message || '请在已安装的 Windows 桌面版中使用更新。',
    error: updateStatus.message || '更新检查失败，请重试。',
  }[updateStatus.state] || '');

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
    setModelList(null);
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

  const importConfiguration = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('import');
    try {
      const raw = JSON.parse(await file.text());
      const safeModel = (model) => {
        if (typeof model === 'string') return model;
        if (!model || typeof model !== 'object') return null;
        const fields = ['id', 'name', 'model', 'capability', 'kind', 'type', 'description', 'desc', 'durationRange', 'price'];
        const safe = Object.fromEntries(fields.filter((key) => model[key] !== undefined).map((key) => [key, model[key]]));
        if (safe.durationRange && typeof safe.durationRange === 'object') {
          const durationFields = ['min', 'max', 'default', 'minSeconds', 'maxSeconds', 'seconds', 'step'];
          safe.durationRange = Object.fromEntries(durationFields.filter((key) => safe.durationRange[key] !== undefined).map((key) => [key, safe.durationRange[key]]));
        }
        if (safe.price !== undefined && !['string', 'number'].includes(typeof safe.price)) delete safe.price;
        return safe;
      };
      const safeBaseUrl = (value) => {
        if (typeof value !== 'string' || !value.trim()) return value;
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Base URL 必须是无账号密码的 HTTP(S) 地址');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/$/, '');
      };
      let safeConfig;
      if (raw?.app === 'infinite-canvas' && raw.config && typeof raw.config === 'object') {
        const configFields = ['baseUrl', 'apiFormat', 'models', 'imageModel', 'videoModel', 'model'];
        const channelFields = ['id', 'name', 'baseUrl', 'base_url', 'apiFormat', 'protocol', 'enabled', 'models'];
        safeConfig = {
          app: raw.app, version: raw.version,
          config: Object.fromEntries(configFields.filter((key) => raw.config[key] !== undefined).map((key) => [key, key === 'baseUrl' ? safeBaseUrl(raw.config[key]) : key === 'models' && Array.isArray(raw.config[key]) ? raw.config[key].map(safeModel).filter(Boolean) : raw.config[key]])),
        };
        if (Array.isArray(raw.config.channels)) safeConfig.config.channels = raw.config.channels.map((channel) => Object.fromEntries(
          channelFields.filter((key) => channel?.[key] !== undefined).map((key) => [key, ['baseUrl', 'base_url'].includes(key) ? safeBaseUrl(channel[key]) : key === 'models' && Array.isArray(channel[key]) ? channel[key].map(safeModel).filter(Boolean) : channel[key]]),
        ));
      } else if (raw?.app === 'weave-canvas' && raw.schemaVersion === 1) {
        safeConfig = {
          app: 'weave-canvas', schemaVersion: 1,
          providers: (Array.isArray(raw.providers) ? raw.providers : []).map((provider) => ({
            id: provider?.id, name: provider?.name, protocol: provider?.protocol, base_url: safeBaseUrl(provider?.base_url),
            models: Array.isArray(provider?.models) ? provider.models.map(safeModel).filter(Boolean) : [],
            enabled: provider?.enabled,
          })),
          aiConfigs: (Array.isArray(raw.aiConfigs) ? raw.aiConfigs : []).map((config) => ({
            purpose: config?.purpose, provider: config?.provider, provider_name: config?.provider_name,
            base_url: safeBaseUrl(config?.base_url), model_id: config?.model_id, provider_id: config?.provider_id,
            custom_api_id: config?.custom_api_id, notes: config?.notes,
          })),
        };
      } else throw new Error('不支持的配置文件格式');
      const result = await api.importConfiguration(safeConfig);
      await load();
      const providerCount = result.imported?.length || 0;
      const modelCount = result.imported?.reduce((sum, provider) => sum + (provider.models || 0), 0) || 0;
      notify(result.credentialsImported
        ? `导入完成：${providerCount} 个渠道、${modelCount} 个模型，API Key 已一并导入。`
        : `导入完成：${providerCount} 个渠道、${modelCount} 个模型。API Key 未导入，请在渠道设置中填写。`);
    } catch (e) {
      notify(`导入失败：${e.message}`, true);
    } finally { setBusy(''); }
  };

  const saveJson = (config, filename) => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportConfiguration = async () => {
    setBusy('export');
    try {
      const config = await api.exportConfiguration();
      saveJson(config, `weave-canvas-config-${new Date().toISOString().slice(0, 10)}.json`);
      notify('配置已导出（不含 API Key 和自定义接口模板）');
    } catch (e) { notify(`导出失败：${e.message}`, true); }
    finally { setBusy(''); }
  };

  // 管理员导出（v0.7.9）：首次使用需设置管理密码，导出的配置包含 API Key
  const adminExportConfiguration = async () => {
    setBusy('adminExport');
    try {
      const st = await api.adminStatus();
      if (!st.configured) {
        const pwd = window.prompt('首次使用：请设置管理密码（至少 4 位）。此后「管理员导出」需输入该密码。');
        if (pwd === null) return;
        await api.adminSetup({ password: pwd });
        notify('管理密码已设置');
      }
      const pwd2 = window.prompt('管理员导出：请输入管理密码（导出的配置包含 API Key，请妥善保管）');
      if (pwd2 === null) return;
      const { token } = await api.adminLogin({ password: pwd2 });
      const config = await api.exportConfigurationRaw(true, token);
      saveJson(config, `weave-canvas-config-admin-${new Date().toISOString().slice(0, 10)}.json`);
      notify('管理员配置已导出（含 API Key，请勿外传）');
    } catch (e) { notify(`管理员导出失败：${e.message}`, true); }
    finally { setBusy(''); }
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
          <span>模型中心</span>
          <button className="ghost" aria-label="关闭设置" onClick={onClose}>×</button>
        </div>

        <div className="config-card" style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="model-card-icon"><img src="/studio-icon.svg" alt="" /></div>
          <div className="model-card-heading">
            <b>AI漫剧工作室</b>
            <span className="hint">{appVersion ? `当前版本 v${appVersion}` : '桌面应用更新'}</span>
            <span className="update-status-message" role="status" aria-live="polite">{updateStatusMessage}</span>
          </div>
          <span className="spacer" />
          <button className={['available', 'downloaded'].includes(updateStatus.state) ? 'primary' : ''}
            onClick={updateAction}
            disabled={['checking', 'downloading', 'unavailable'].includes(updateStatus.state)}>
            {updateButtonText}
          </button>
        </div>

        <div className="modal-body scroll">
          <section className="update-release-history" aria-labelledby="update-release-title">
            <div className="update-release-heading">
              <div>
                <b id="update-release-title">最近 3 次更新内容</b>
                <span className="hint">只显示已正式发布的版本</span>
              </div>
              {recentReleasesState === 'loading' && <span className="hint" role="status">正在加载…</span>}
            </div>
            {recentReleasesState === 'error' && <p className="hint" role="status">暂时无法获取更新内容，请检查网络后重新打开设置。</p>}
            {recentReleasesState === 'unavailable' && <p className="hint">更新记录仅在桌面版中提供。</p>}
            {recentReleasesState === 'empty' && <p className="hint">暂时没有已发布的更新记录。</p>}
            {recentReleasesState === 'ready' && (
              <ol className="update-release-list">
                {recentReleases.map((release) => (
                  <li className="update-release-item" key={release.version}>
                    <div className="update-release-meta">
                      <b>{release.name || release.version}</b>
                      <span>{release.version}</span>
                      {formatReleaseDate(release.publishedAt) && <time>{formatReleaseDate(release.publishedAt)}</time>}
                    </div>
                    <div className="update-release-notes"><ReleaseNotesBody notes={release.notes} /></div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="model-center-nav">
            <input ref={configFileRef} className="config-import-input" type="file" accept=".json,application/json" onChange={importConfiguration} />
            <div className="model-center-mode" role="tablist" aria-label="模型配置方式">
              <button role="tab" aria-selected={tab === 'source'} aria-pressed={tab === 'source'} className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>精选</button>
              <button role="tab" aria-selected={tab === 'provider'} aria-pressed={tab === 'provider'} className={tab === 'provider' ? 'active' : ''} onClick={() => setTab('provider')}>自定义</button>
            </div>
            <button className={`model-center-custom-link ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>自定义接口</button>
            <div className="config-transfer-actions">
              <button onClick={() => configFileRef.current?.click()} disabled={!!busy}>导入配置</button>
              <button onClick={exportConfiguration} disabled={!!busy}>{busy === 'export' ? '导出中…' : '导出配置'}</button>
              <button onClick={adminExportConfiguration} disabled={!!busy} title="输入管理密码后导出，包含 API Key">{busy === 'adminExport' ? '导出中…' : '管理员导出'}</button>
            </div>
          </div>

          {tab === 'source' && (
            <>
              <div className="model-purpose-tabs" role="tablist" aria-label="模型类型">
                {MODEL_CATEGORIES.map((category) => (
                  <button key={category.key} role="tab" aria-selected={purposeTab === category.key}
                    aria-pressed={purposeTab === category.key} disabled={category.disabled}
                    title={category.disabled ? '音频模型接入暂未开放' : undefined}
                    className={purposeTab === category.key ? 'active' : ''}
                    onClick={() => { setPurposeTab(category.key); setModelList(null); }}>
                    {category.title}
                    {category.disabled && <span className="model-coming-soon">即将支持</span>}
                  </button>
                ))}
              </div>

              <div className="model-center-banner">
                <div className="model-banner-copy">
                  <b>快速接入 · 主流模型服务</b>
                  <p>连接厂商 API 或自建兼容网关。配置 Base URL 和 API Key 后，可在下方拉取模型、测试连通性。</p>
                </div>
                <button className="model-banner-action" onClick={() => setTab('provider')}>+ 添加供应商</button>
              </div>
            </>
          )}

          {tab === 'source' && PURPOSES.filter((p) => p.key === purposeTab).map((p) => {
            const f = configs[p.key] || {};
            const tr = testResult[p.key];
            return (
              <div className="config-card model-purpose-card" key={p.key}>
                <div className="config-head">
                  <div className="model-card-icon"><ModelKindIcon kind={p.key} /></div>
                  <div className="model-card-heading"><b>{p.title}</b><span className="hint">{p.desc}</span></div>
                  <span className="spacer" />
                  <span className={`keytag ${f.has_key || f.provider_id ? 'ok' : ''}`}>
                    {f.custom_api_name || f.provider_name || (f.has_key ? '已配置' : '待配置')}
                  </span>
                </div>

                <div className="row3">
                  <div className="field">
                    <label className="field-label" htmlFor={`source-${p.key}`}>来源</label>
                    <select
                      id={`source-${p.key}`}
                      value={f.custom_api_id ? `ca:${f.custom_api_id}` : f.provider_id ? `pv:${f.provider_id}` : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setModelList(null);
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
                    <label className="field-label" htmlFor={`model-id-${p.key}`}>模型名</label>
                    <input id={`model-id-${p.key}`} value={f.model_id || ''}
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
                      <label className="field-label" htmlFor={`base-url-${p.key}`}>Base URL</label>
                      <input id={`base-url-${p.key}`} value={f.base_url || ''} placeholder="https://api.example.com/v1"
                        onChange={(e) => patch(p.key, { base_url: e.target.value })} />
                    </div>
                    <div className="field">
                      <div className="model-key-label-row">
                        <label className="field-label" htmlFor={`api-key-${p.key}`}>API Key</label>
                        {f.has_key && <span className="keytag ok" style={{ marginLeft: 6 }}>已保存 {f.key_hint}</span>}
                        {f.has_key && !f.clear && (
                          <button className="ghost tiny" style={{ marginLeft: 6 }}
                            onClick={() => patch(p.key, { clear: true, api_key: '', has_key: false })}>清除</button>
                        )}
                        {f.clear && <button className="ghost tiny" style={{ marginLeft: 6 }} onClick={() => patch(p.key, { clear: false })}>取消清除</button>}
                      </div>
                      <div className="model-secret-field">
                        <input id={`api-key-${p.key}`} type={visibleKeys[p.key] ? 'text' : 'password'} autoComplete="new-password" spellCheck={false}
                          value={f.api_key || ''} disabled={f.clear} aria-label={`${p.title} API Key`}
                          placeholder={f.has_key ? '留空 = 不修改，粘贴新 Key 则覆盖' : '粘贴 API Key'}
                          onChange={(e) => patch(p.key, { api_key: e.target.value })} />
                        <button type="button" className="model-secret-toggle" aria-label={visibleKeys[p.key] ? '隐藏 API Key' : '显示 API Key'}
                          onClick={() => setVisibleKeys((v) => ({ ...v, [p.key]: !v[p.key] }))}>{visibleKeys[p.key] ? '隐藏' : '显示'}</button>
                      </div>
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
                            aria-pressed={f.model_id === m}
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
                <button className="primary" onClick={() => { setVisibleProviderKey(false); setEditing({ name: '', protocol: 'openai', base_url: '', api_key: '', notes: '' }); }}>+ 新建供应商</button>
                <span className="hint">管理主流厂商、自建网关或 OpenAI 兼容服务；模型中心可自动拉取模型。</span>
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
                      <button className="tiny" onClick={() => { setVisibleProviderKey(false); setEditing({ ...p, api_key: '', clear: false }); }}>编辑</button>
                      <button className="ghost tiny" onClick={() => removeProvider(p)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>

              {editing && (
                <div className="config-card">
                  <div className="config-head"><b>{editing.id ? '编辑供应商' : '新建供应商'}</b></div>
                  <div className="row3">
                    <div className="field"><label className="field-label" htmlFor="provider-name">名称</label>
                      <input id="provider-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                    <div className="field"><label className="field-label" htmlFor="provider-protocol">协议</label>
                      <select id="provider-protocol" value={editing.protocol} onChange={(e) => setEditing({ ...editing, protocol: e.target.value })}>
                        {protocols.map((pr) => <option key={pr.key} value={pr.key}>{pr.name}</option>)}
                      </select></div>
                    <div className="field"><label className="field-label" htmlFor="provider-base-url">Base URL</label>
                      <input id="provider-base-url" value={editing.base_url} onChange={(e) => setEditing({ ...editing, base_url: e.target.value })} /></div>
                  </div>
                  <div className="row3">
                    <div className="field">
                      <label className="field-label" htmlFor="provider-api-key">API Key {editing.has_key && <span className="keytag ok" style={{ marginLeft: 6 }}>已存 {editing.key_hint}</span>}</label>
                      <div className="model-secret-field">
                        <input id="provider-api-key" type={visibleProviderKey ? 'text' : 'password'} autoComplete="new-password"
                          value={editing.api_key || ''} aria-label="供应商 API Key"
                          placeholder={editing.has_key ? '留空 = 不修改' : '粘贴 Key'}
                          onChange={(e) => setEditing({ ...editing, api_key: e.target.value })} />
                        <button type="button" className="model-secret-toggle" aria-label={visibleProviderKey ? '隐藏供应商 API Key' : '显示供应商 API Key'}
                          onClick={() => setVisibleProviderKey((v) => !v)}>{visibleProviderKey ? '隐藏' : '显示'}</button>
                      </div>
                    </div>
                    <div className="field" style={{ gridColumn: 'span 2' }}>
                      <label className="field-label" htmlFor="provider-notes">备注</label>
                      <input id="provider-notes" value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
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
