import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

/* 豆包号池面板：桥接服务生命周期 + 多账号管理
   自包含（自己的 state 与请求），只在 SettingsModal 里被渲染。 */

const STATUS_META = {
  active: { text: '可用', bg: '#E1F5EE', fg: '#0F6E56' },
  cooling: { text: '冷却中', bg: '#FAEEDA', fg: '#854F0B' },
  exhausted: { text: '额度耗尽', bg: '#FCEBEB', fg: '#A32D2D' },
  logged_out: { text: '需重新登录', bg: '#FCEBEB', fg: '#A32D2D' },
  disabled: { text: '已停用', bg: '#F1EFE8', fg: '#5F5E5A' },
  probation: { text: '试探中', bg: '#E6F1FB', fg: '#185FA5' },
};

const Badge = ({ status }) => {
  const m = STATUS_META[status] || { text: status, bg: '#F1EFE8', fg: '#5F5E5A' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 99, fontSize: 12,
      background: m.bg, color: m.fg, whiteSpace: 'nowrap',
    }}>{m.text}</span>
  );
};

const card = {
  background: '#fff', border: '1px solid #e5e3dd', borderRadius: 12,
  padding: '14px 18px', marginBottom: 12, fontSize: 13, lineHeight: 1.8,
};
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: '#5f5e5a', fontWeight: 500, background: '#f6f4ef' };
const td = { padding: '8px 10px', borderBottom: '1px solid #f0eee8', verticalAlign: 'top' };
const mono = { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 };
const btn = { fontSize: 11, padding: '2px 8px', marginRight: 4, border: '1px solid #d3d1c7', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#444441' };

export default function DoubaoPoolPanel() {
  const [st, setSt] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [alias, setAlias] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setBusy((b) => (b === 'init' ? b : 'init'));
    try {
      const s = await api.doubaoStatus();
      setSt(s);
      if (s?.running) setAccounts(await api.doubaoAccounts());
      else setAccounts([]);
    } catch (e) {
      setSt({ found: false, running: false, error: e.message });
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (label, fn) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof r === 'string' ? r : (r?.detail || r?.error || `${label}完成`) });
      await load({ quiet: true });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy('');
    }
  };

  const pool = st?.pool;
  const baseUrl = st?.baseUrl || (st?.port ? `http://127.0.0.1:${st.port}` : '');

  return (
    <div>
      {/* ---- 桥接服务状态 ---- */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>桥接服务</b>
          <span style={{
            padding: '2px 10px', borderRadius: 99, fontSize: 12,
            background: st?.running ? '#E1F5EE' : '#F1EFE8',
            color: st?.running ? '#0F6E56' : '#5F5E5A',
          }}>
            {st == null ? '检测中…' : st.running ? '运行中' : '未运行'}
          </span>
          {st?.spawnedByUs && <span style={{ fontSize: 12, color: '#888780' }}>（由本软件启动）</span>}

          <span style={{ flex: 1 }} />
          {st?.running
            ? <button style={btn} disabled={!!busy} onClick={() => run('重启桥接', api.doubaoRestart)}>{busy === '重启桥接' ? '重启中…' : '重启'}</button>
            : <button style={btn} disabled={!!busy} onClick={() => run('启动桥接', api.doubaoStart)}>{busy === '启动桥接' ? '启动中…' : '启动'}</button>}
          {st?.running && <button style={btn} disabled={!!busy} onClick={() => run('停止桥接', api.doubaoStop)}>停止</button>}
          <button style={btn} disabled={!!busy} onClick={() => load()}>刷新</button>
        </div>

        {st?.found ? (
          <div style={{ color: '#5f5e5a' }}>
            <div>桥接目录：<span style={mono}>{st.dir}</span></div>
            {baseUrl && <div>服务地址：<span style={mono}>{baseUrl}</span></div>}
            {st.provider && (
              <div>
                预置供应商：<b>{st.provider.name}</b>
                <span style={{ marginLeft: 8, ...mono }}>{st.provider.protocol} · {st.provider.baseUrl}</span>
                {!st.provider.hasKey && <span style={{ color: '#A32D2D', marginLeft: 8 }}>缺少 Key（应为 local）</span>}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#A32D2D' }}>
            {st?.installHint || '未找到 doubao-bridge 目录'}
            <div style={{ marginTop: 6, color: '#5f5e5a' }}>
              把 doubao-bridge 放在 <span style={mono}>weave-canvas</span> 的同级目录即可自动识别，或在下方手动指定路径。
            </div>
          </div>
        )}

        {st?.lastError && <div style={{ color: '#A32D2D', marginTop: 6 }}>最近错误：{st.lastError}</div>}
      </div>

      {/* ---- 号池概览 ---- */}
      {st?.running && pool && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: '#5f5e5a' }}>池内剩余额度</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: pool.totalRemaining === 0 ? '#A32D2D' : '#0F6E56' }}>
                {pool.totalRemaining} / {pool.totalCapacity}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#5f5e5a' }}>可用账号</div>
              <div style={{ fontSize: 20, fontWeight: 500 }}>{pool.usableCount} / {pool.accountCount}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#5f5e5a' }}>调度策略</div>
              <div style={{ fontSize: 13 }}>{pool.strategy}</div>
            </div>
            <span style={{ flex: 1 }} />
            <button
              style={{ ...btn, padding: '5px 12px', fontSize: 12 }}
              disabled={!!busy}
              onClick={() => run('切换视频模型', async () => {
                const r = await api.doubaoUseForVideo({});
                return `已把「视频模型」用途切到 ${r.providerName}（${r.model}）。注意 Seedance 2.5 是 5 倍消耗，可在上方「精选」页签换成便宜的档位。`;
              })}
            >
              把视频模型切到豆包号池
            </button>
          </div>

          {/* ---- 账号切换：自动轮询 / 锁定某个号 ---- */}
          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0eee8',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: '#5f5e5a' }}>账号切换</span>
            {pool.mode === 'pinned' ? (
              <>
                <span style={{
                  padding: '2px 10px', borderRadius: 99, fontSize: 12,
                  background: pool.nextAccountId ? '#FAEEDA' : '#FCEBEB',
                  color: pool.nextAccountId ? '#633806' : '#791F1F',
                }}>
                  已锁定：{pool.pinnedAlias}（只用这个号）
                </span>
                {!pool.nextAccountId && (
                  <span style={{ fontSize: 12, color: '#A32D2D' }}>
                    ⚠ 这个号当前不可用（未登录 / 额度耗尽 / 已停用），<b>任务会直接失败，不会自动换号</b>
                  </span>
                )}
                <button
                  style={{ ...btn, padding: '3px 10px', fontSize: 12 }}
                  disabled={!!busy}
                  onClick={() => run('解除锁定', async () => {
                    await api.doubaoUnpinAccount();
                    return '已解除锁定，回到自动轮询';
                  })}
                >
                  解除锁定，回到自动轮询
                </button>
              </>
            ) : (
              <>
                <span style={{
                  padding: '2px 10px', borderRadius: 99, fontSize: 12,
                  background: '#E1F5EE', color: '#0F6E56',
                }}>
                  自动轮询
                </span>
                {pool.nextAccountAlias && (
                  <span style={{ fontSize: 12, color: '#5f5e5a' }}>
                    下一个会用：<b style={{ color: '#2c2c2a' }}>{pool.nextAccountAlias}</b>
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#888780' }}>
                  （点下方账号行的「用这个号」可锁定）
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div style={{ ...card, background: msg.ok ? '#E1F5EE' : '#FCEBEB', color: msg.ok ? '#0F6E56' : '#A32D2D', padding: '10px 14px' }}>
          {msg.text}
        </div>
      )}

      {/* ---- 可选模型与消耗倍率 ---- */}
      {st?.running && (st.models || []).length > 0 && (
        <div style={{ ...card, padding: '10px 16px' }}>
          <div style={{ fontSize: 12, color: '#5f5e5a', marginBottom: 8 }}>
            可选模型（<b>消耗倍率</b> = 每次生成扣几次免费额度；账号每天 10 次）
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {st.models.map((m) => (
              <span key={m.id} style={{
                padding: '5px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: m.costMultiplier >= 5 ? '#FCEBEB' : m.costMultiplier >= 2 ? '#FAEEDA' : '#E1F5EE',
                color: m.costMultiplier >= 5 ? '#791F1F' : m.costMultiplier >= 2 ? '#633806' : '#0F6E56',
                border: '1px solid rgba(0,0,0,.06)',
              }}>
                {m.uiText}
                <span style={{ marginLeft: 6, opacity: .85 }}>
                  {m.costMultiplier}× · 每天约 {Math.floor(10 / m.costMultiplier)} 条
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---- 账号列表 ---- */}
      {st?.running && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f0eee8' }}>
            <b style={{ fontSize: 13 }}>账号（每个账号一个独立浏览器，各自每天 10 次）</b>
            <span style={{ flex: 1 }} />
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="新账号别名，如 豆包-02"
              style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #d3d1c7', borderRadius: 6, width: 160 }}
            />
            <button
              style={{ ...btn, padding: '4px 10px', fontSize: 12 }}
              disabled={!!busy}
              onClick={() => run('新增账号', async () => {
                const r = await api.doubaoAddAccount({ alias: alias.trim() || undefined });
                setAlias('');
                return `已新增「${r.alias}」，端口 :${r.debugPort}。下一步给它登录：node tools/login.js ${r.id}`;
              })}
            >
              新增账号
            </button>
            <button style={{ ...btn, padding: '4px 10px', fontSize: 12 }} disabled={!!busy} onClick={() => run('重置台账', api.doubaoResetPool)}>
              重置台账
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>账号</th><th style={th}>状态</th><th style={th}>今日剩余</th>
                <th style={th}>成功/失败</th><th style={th}>端口</th><th style={th}>最近错误</th><th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    <div>
                      <b>{a.alias}</b>
                      {pool?.pinnedId === a.id && (
                        <span style={{ marginLeft: 6, padding: '1px 7px', borderRadius: 99, fontSize: 11, background: '#FAEEDA', color: '#633806' }}>当前</span>
                      )}
                    </div>
                    <div style={{ ...mono, color: '#888780' }}>{a.id}</div>
                  </td>
                  <td style={td}><Badge status={a.enabled ? a.status : 'disabled'} /></td>
                  <td style={td}>
                    <span style={{ ...mono, color: a.remaining === 0 ? '#A32D2D' : undefined }}>{a.remaining}/{a.dailyFree}</span>
                    <div style={{ height: 3, background: '#f0eee8', borderRadius: 2, width: 60, marginTop: 4 }}>
                      <div style={{ height: '100%', width: `${a.dailyFree ? (a.remaining / a.dailyFree) * 100 : 0}%`, background: '#1D9E75', borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={td}>{a.totalSuccess} / {a.totalFail}</td>
                  <td style={{ ...td, ...mono }}>:{a.debugPort}</td>
                  <td style={{ ...td, fontSize: 12, color: '#A32D2D', maxWidth: 180 }}>
                    {a.lastError ? String(a.lastError).slice(0, 40) : '—'}
                  </td>
                  <td style={td}>
                    {pool?.pinnedId === a.id
                      ? <button style={btn} disabled={!!busy} onClick={() => run('解除锁定', async () => { await api.doubaoUnpinAccount(); return '已解除锁定，回到自动轮询'; })}>解除锁定</button>
                      : <button style={btn} disabled={!!busy} onClick={() => run('用这个号', async () => { await api.doubaoPinAccount(a.id); return `已锁定「${a.alias}」，后续任务只用它`; })}>用这个号</button>}
                    {a.enabled
                      ? <button style={btn} disabled={!!busy} onClick={() => run('停用账号', () => api.doubaoUpdateAccount(a.id, { enabled: false }))}>停用</button>
                      : <button style={btn} disabled={!!busy} onClick={() => run('启用账号', () => api.doubaoUpdateAccount(a.id, { enabled: true }))}>启用</button>}
                    <button style={btn} disabled={!!busy} onClick={() => run('探活', () => api.doubaoAccountAction(a.id, 'probe'))}>探活</button>
                    <button style={btn} disabled={!!busy} onClick={() => run('恢复', () => api.doubaoAccountAction(a.id, 'recover'))}>恢复</button>
                    <button style={btn} disabled={!!busy} onClick={() => run('冷却', () => api.doubaoAccountAction(a.id, 'cooldown', { seconds: 120, reason: '手动' }))}>冷却</button>
                    <button style={btn} disabled={!!busy} onClick={() => run('删除', () => api.doubaoDeleteAccount(a.id))}>删除</button>
                  </td>
                </tr>
              ))}
              {!accounts.length && (
                <tr><td style={td} colSpan={7}>还没有账号。点右上「新增账号」创建，然后给每个账号单独登录。</td></tr>
              )}
            </tbody>
          </table>

          <div style={{ padding: '10px 16px', fontSize: 12, color: '#5f5e5a', background: '#faf9f7' }}>
            新账号需要登录一次（会为该账号单独打开一个浏览器窗口）：
            <div style={{ ...mono, marginTop: 4, color: '#2c2c2a' }}>
              cd "{st.dir}" &amp;&amp; node tools/login.js &lt;账号 id&gt;
            </div>
            <div style={{ marginTop: 6 }}>
              每个账号必须独立登录：同一个浏览器多标签页会共享 Cookie，登录新账号会把旧账号顶掉。
            </div>
          </div>
        </div>
      )}

      {/* ---- 产物目录 + 最近日志 ---- */}
      {st?.running && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#5f5e5a' }}>桥接日志</span>
            <button style={btn} onClick={() => setShowLogs((v) => !v)}>{showLogs ? '收起' : '展开'}</button>
            <span style={{ flex: 1 }} />
            <button style={btn} onClick={() => load()}>刷新</button>
          </div>
          {showLogs && (
            <pre style={{
              marginTop: 8, maxHeight: 200, overflow: 'auto', background: '#f6f4ef',
              borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            }}>
              {(st.logs || []).join('\n') || '（暂无日志）'}
            </pre>
          )}
        </div>
      )}

      {/* ---- 使用提示 ---- */}
      <div style={{ ...card, background: '#faf9f7', color: '#5f5e5a', fontSize: 12 }}>
        <b style={{ color: '#2c2c2a' }}>怎么在画布上用：</b>
        上面的「把视频模型切到豆包号池」会自动配好供应商与模型，之后在分镜页或
        <span style={mono}> VideoNode </span>
        里正常生成即可，号池会在后台自动选号、失败自动换号。
        <div style={{ marginTop: 8, color: '#A32D2D' }}>
          注意：豆包免费额度每个账号每天 10 次，每日 0 点刷新，且不支持真人图片作参考图。
          <b>额度按模型分档消耗</b>：Seedance 2.0 Fast 基准（5 秒 1 次），
          <b>Seedance 2.0 是 2 倍</b>、<b>Seedance 2.5 是 5 倍</b> —— 用 2.5 时每天 10 次只够出 2 条 5 秒视频。
          多账号刷免费额度可能违反平台规则，请自行评估风险。
        </div>
      </div>
    </div>
  );
}
