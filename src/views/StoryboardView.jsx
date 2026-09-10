import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

const COLS = [2, 3, 4];
const STATUS = { idle: '待生成', running: '生图中', video: '出视频中', done: '已完成', error: '失败' };
const JOB_LABEL = { 'shot.image': '批量生图', 'shot.video': '批量视频', 'movie.export': '成片导出' };

function charsOf(shot) {
  try { return JSON.parse(shot.character_ids || '[]'); } catch { return []; }
}

export default function StoryboardView() {
  const { script, characters, styleId, modelGroups, modelDefaults, notify, shotsTick } = useApp();
  const [shots, setShots] = useState([]);
  const [cols, setCols] = useState(3);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [imgModel, setImgModel] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [variants, setVariants] = useState(1);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState('');
  const [variantsMap, setVariantsMap] = useState({});
  const [movie, setMovie] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [videoOpt, setVideoOpt] = useState({ duration: 5, ratio: '9:16' });
  const timer = useRef(null);

  const reload = useCallback(async () => {
    if (!script) { setShots([]); return; }
    setShots(await api.listShots(script.id));
  }, [script]);

  useEffect(() => { reload().catch((e) => notify(e.message, true)); }, [reload, shotsTick]);

  // 恢复最近一次成片（切走再回来也能看到）
  useEffect(() => {
    if (!script) { setMovie(null); return; }
    api.media(script.id).then((list) => {
      const last = list.find((m) => m.kind === 'movie');
      if (!last) return setMovie(null);
      let meta = {};
      try { meta = JSON.parse(last.meta_json || '{}'); } catch { /* ignore */ }
      setMovie({
        url: last.file_path, srt: meta.srt || null, duration: last.duration || 0,
        shots: meta.shots || 0, skipped: meta.skipped || [], width: meta.width, height: meta.height,
      });
    }).catch(() => { /* ignore */ });
  }, [script?.id, job?.status]);

  useEffect(() => {
    if (!job || job.status !== 'running') {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(async () => {
      try {
        const j = await api.getJob(job.id);
        setJob(j);
        if (j.status !== 'running') {
          await reload();
          const label = JOB_LABEL[j.kind] || '任务';
          if (j.kind === 'movie.export' && j.log?.[0]?.result?.url) {
            setMovie(j.log[0].result);
            notify(`成片已导出：${j.log[0].result.shots} 个镜头 · ${Math.round(j.log[0].result.duration)} 秒${j.log[0].result.skipped?.length ? `（跳过 ${j.log[0].result.skipped.length} 个空镜）` : ''}`);
          } else {
            notify(`${label}完成：成功 ${j.done}，失败 ${j.failed}`, j.failed > 0);
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  const patchShot = async (id, patch, reindex) => {
    setShots((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    try {
      const saved = await api.updateShot(id, patch);
      if (reindex) setShots((list) => list.map((s) => (s.id === id ? saved : s)));
    } catch (e) { notify(`保存失败：${e.message}`, true); }
  };

  const loadVariants = async (shotId) => {
    const list = await api.listVariants(shotId);
    setVariantsMap((m) => ({ ...m, [shotId]: list }));
  };

  const genOne = async (shot) => {
    setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, status: 'running', error: null } : s)));
    try {
      const r = await api.shotImage(shot.id, {
        styleId: shot.style_id || styleId, modelId: imgModel || undefined, size: '1024x1536', variants,
      });
      setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, image_url: r.image_url, status: 'done', prompt_used: r.prompt, error: null } : s)));
      await loadVariants(shot.id);
      notify(`镜头 ${shot.seq} 已生成${variants > 1 ? ` ${variants} 个版本` : ''}`);
    } catch (e) {
      setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, status: 'error', error: e.message } : s)));
      notify(`镜头 ${shot.seq} 失败：${e.message}`, true);
    }
  };

  const genVideo = async (shot) => {
    setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, status: 'video', error: null } : s)));
    notify(`镜头 ${shot.seq} 开始图生视频（${videoOpt.duration}s / ${videoOpt.ratio}），约 1-3 分钟…`);
    try {
      const r = await api.shotVideo(shot.id, {
        modelId: videoModel || undefined, duration: videoOpt.duration, ratio: videoOpt.ratio,
      });
      setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, video_url: r.video_url, status: 'done', error: null } : s)));
      notify(`镜头 ${shot.seq} 视频已生成`);
    } catch (e) {
      setShots((list) => list.map((s) => (s.id === shot.id ? { ...s, status: 'error', error: e.message } : s)));
      notify(`镜头 ${shot.seq} 视频失败：${e.message}`, true);
    }
  };

  const saveVideoOpt = (shot, patch) => {
    setVideoOpt((v) => ({ ...v, ...patch }));
    if (patch.duration && shot) patchShot(shot.id, { duration: patch.duration }, true);
    if (patch.ratio && shot) patchShot(shot.id, { ratio: patch.ratio });
  };

  const selectVariant = async (shot, variantId) => {
    try {
      const saved = await api.selectVariant(shot.id, { variantId });
      setShots((list) => list.map((s) => (s.id === shot.id ? saved : s)));
      await loadVariants(shot.id);
      notify(`镜头 ${shot.seq} 已采用该版本`);
    } catch (e) { notify(e.message, true); }
  };

  const startJob = async (kind, fn) => {
    setBusy(kind);
    try {
      const r = await fn();
      setJob({ id: r.jobId, status: 'running', total: r.total, done: 0, failed: 0, kind });
      notify(`${JOB_LABEL[kind]}已提交（${r.total} 项）`);
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const addShot = async () => {
    const s = await api.createShot(script.id, { scene: '新镜头：请描述画面', duration: 5, characterIds: [] });
    setShots((list) => [...list, s]);
  };

  const removeShot = async (id) => {
    await api.deleteShot(id);
    setShots((list) => list.filter((s) => s.id !== id));
  };

  const toggleChar = (shot, charId) => {
    const cur = charsOf(shot);
    const next = cur.includes(charId) ? cur.filter((c) => c !== charId) : [...cur, charId];
    patchShot(shot.id, { characterIds: next });
  };

  if (!script) {
    return <div className="view-body center"><div className="empty-card"><h3>先创建一个剧本</h3><p className="hint">分镜依附于剧本，去「剧本」页新建并拆分镜。</p></div></div>;
  }

  const progress = job && job.total ? Math.round(((job.done + job.failed) / job.total) * 100) : 0;
  const noImage = shots.filter((s) => !s.image_url).length;
  const selected = shots.find((s) => s.id === selectedId) || null;

  return (
    <>
      <div className="view-bar">
        <span className="pill">分镜 · {script.title}</span>
        <span className="pill">{shots.length} 镜{noImage ? ` · ${noImage} 镜待出图` : ''}</span>
        <div className="sep" />
        <span className="pill">宫格</span>
        {COLS.map((c) => <button key={c} className={cols === c ? 'primary' : ''} onClick={() => setCols(c)}>{c} 列</button>)}
        <div className="sep" />
        <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} style={{ width: 180 }} title="图像模型">
          <option value="">图像模型：默认{modelDefaults?.image ? `(${modelDefaults.image})` : ''}</option>
          {(modelGroups?.image || []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={videoModel} onChange={(e) => setVideoModel(e.target.value)} style={{ width: 170 }} title="视频模型">
          <option value="">视频模型：默认{modelDefaults?.video ? `(${modelDefaults.video})` : ''}</option>
          {(modelGroups?.video || []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={variants} onChange={(e) => setVariants(Number(e.target.value))} style={{ width: 110 }} title="每次生成的版本数">
          {[1, 2, 4].map((n) => <option key={n} value={n}>每镜 {n} 版</option>)}
        </select>
        <select value={videoOpt.duration} onChange={(e) => setVideoOpt({ ...videoOpt, duration: Number(e.target.value) })} style={{ width: 96 }} title="视频时长">
          {[5, 8, 10].map((n) => <option key={n} value={n}>视频 {n}s</option>)}
        </select>
        <select value={videoOpt.ratio} onChange={(e) => setVideoOpt({ ...videoOpt, ratio: e.target.value })} style={{ width: 96 }} title="视频比例">
          {['9:16', '16:9', '1:1'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="checkline">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          只处理缺失的
        </label>
        <div className="sep" />
        <button className="primary" disabled={busy === 'image' || !shots.length}
          onClick={() => startJob('shot.image', () => api.batchImages(script.id, { styleId, onlyMissing, modelId: imgModel || undefined, size: '1024x1536' }))}>
          {busy === 'image' ? '提交中…' : '⚡ 批量生图'}
        </button>
        <button disabled={busy === 'video' || !shots.length}
          onClick={() => startJob('shot.video', () => api.batchVideos(script.id, { onlyMissing, modelId: videoModel || undefined }))}>
          {busy === 'video' ? '提交中…' : '🎞 批量视频'}
        </button>
        <button className="primary" disabled={busy === 'export'}
          onClick={() => startJob('movie.export', () => api.exportMovie(script.id, { width: 1080, height: 1920, fps: 30 }))}>
          {busy === 'export' ? '提交中…' : '🎬 导出成片'}
        </button>
        <button onClick={addShot}>+ 加一镜</button>
        <div className="spacer" />
        {movie && <a className="btn" href={movie.url} download>下载成片</a>}
        {movie?.srt && <a className="btn" href={movie.srt} download>字幕</a>}
        {job && <span className="pill">{JOB_LABEL[job.kind] || '任务'} {job.done + job.failed}/{job.total} · 失败 {job.failed} · {progress}%</span>}
      </div>

      {job && <div className="progress-wrap"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>}

      <div className="view-body">
        {movie && (
          <div className="movie-bar">
            <video src={movie.url} controls style={{ maxHeight: 220 }} />
            <div>
              <b>最新成片</b>
              <div className="hint">{movie.shots} 个镜头 · {Math.round(movie.duration)} 秒 · {movie.width}×{movie.height}{movie.skipped?.length ? ` · 跳过空镜 ${movie.skipped.join('、')}` : ''}</div>
              <div className="snippet-actions" style={{ marginTop: 8 }}>
                <a className="btn" href={movie.url} download>下载 MP4</a>
                {movie.srt && <a className="btn" href={movie.srt} download>下载字幕 SRT</a>}
              </div>
            </div>
          </div>
        )}

        {!shots.length && (
          <div className="empty-card">
            <h3>还没有镜头</h3>
            <p className="hint">回到「剧本」页点「① 一键拆分镜」，AI 会把剧本拆成带画面描述、台词、镜头语言的镜头表。</p>
          </div>
        )}
        <div className="board-wrap">
          <div className="board" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shots.map((shot) => {
            const cast = charsOf(shot);
            const vlist = variantsMap[shot.id] || [];
            return (
              <div className={`shot ${shot.status || ''} ${selectedId === shot.id ? 'sel' : ''}`} key={shot.id}>
                <div className="shot-head" onClick={() => setSelectedId(shot.id)} style={{ cursor: 'pointer' }}>
                  <span className="seq">{shot.seq}</span>
                  <span className={`badge ${shot.status === 'done' ? 'done' : shot.status === 'running' || shot.status === 'video' ? 'running' : shot.status === 'error' ? 'error' : ''}`}>
                    {STATUS[shot.status] || '待生成'}
                  </span>
                  <span className="spacer" />
                  <span className="pill">{shot.duration}s</span>
                  <button className="ghost tiny" onClick={() => removeShot(shot.id)}>×</button>
                </div>

                <div className="shot-img" onClick={() => setSelectedId(shot.id)} style={{ cursor: 'pointer' }}>
                  {shot.video_url
                    ? <video src={shot.video_url} controls muted loop playsInline />
                    : shot.image_url
                      ? <img src={shot.image_url} alt={`镜头 ${shot.seq}`} />
                      : <span className="hint">{shot.status === 'running' ? '生成中…' : '尚未出图'}</span>}
                </div>

                {vlist.length > 1 && (
                  <div className="variant-strip">
                    {vlist.map((v, i) => (
                      <button key={v.id} className={`variant ${shot.image_url === v.image_url ? 'on' : ''}`}
                        title={`采用第 ${vlist.length - i} 版`} onClick={() => selectVariant(shot, v.id)}>
                        <img src={v.image_url} alt={`版本 ${i + 1}`} />
                        <span>{vlist.length - i}</span>
                      </button>
                    ))}
                    <button className="ghost tiny" onClick={() => loadVariants(shot.id)}>刷新版本</button>
                  </div>
                )}

                <div className="shot-body">
                  <textarea className="nodrag" rows={3} value={shot.scene} placeholder="画面描述"
                    onChange={(e) => patchShot(shot.id, { scene: e.target.value })} />
                  <textarea className="nodrag" rows={2} value={shot.dialogue || ''} placeholder="台词 / 旁白"
                    onChange={(e) => patchShot(shot.id, { dialogue: e.target.value })} />
                  <div className="row2">
                    <input value={shot.camera || ''} placeholder="镜头语言"
                      onChange={(e) => patchShot(shot.id, { camera: e.target.value })} />
                    <input type="number" min="1" max="20" value={shot.duration || 5}
                      onChange={(e) => patchShot(shot.id, { duration: Number(e.target.value) }, true)} />
                  </div>

                  {!!characters.length && (
                    <div className="chips">
                      {characters.map((c) => (
                        <button key={c.id} className={`chip ${cast.includes(c.id) ? 'on' : ''}`} onClick={() => toggleChar(shot, c.id)}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {shot.error && <div className="err-box">{shot.error}</div>}
                </div>

                <div className="shot-foot">
                  <button className="primary" onClick={() => genOne(shot)} disabled={shot.status === 'running' || shot.status === 'video'}>
                    {shot.image_url ? '重生成图' : '生成分镜图'}
                  </button>
                  <button onClick={() => genVideo(shot)} disabled={!shot.image_url || shot.status === 'video' || shot.status === 'running'}>
                    {shot.video_url ? '重生成视频' : '图生视频'}
                  </button>
                  {shot.image_url && <a className="btn" href={shot.image_url} download>图</a>}
                  {shot.video_url && <a className="btn" href={shot.video_url} download>视频</a>}
                  {shot.prompt_used && (
                    <button className="ghost tiny" title={shot.prompt_used}
                      onClick={() => { navigator.clipboard.writeText(shot.prompt_used); notify('提示词已复制'); }}>提示词</button>
                  )}
                </div>
              </div>
            );
          })}
          </div>

          {selected && (
            <aside className="inspector">
              <div className="insp-head">
                <b>镜头 {selected.seq}</b>
                <span className={`badge ${selected.status === 'done' ? 'done' : selected.status === 'error' ? 'error' : selected.status ? 'running' : ''}`}>
                  {STATUS[selected.status] || '待生成'}
                </span>
                <span className="spacer" />
                <button className="ghost tiny" onClick={() => setSelectedId(null)}>×</button>
              </div>

              <div className="insp-preview">
                {selected.video_url
                  ? <video src={selected.video_url} controls muted loop playsInline />
                  : selected.image_url ? <img src={selected.image_url} alt="" />
                    : <span className="hint">尚未出图</span>}
              </div>

              <div className="insp-body">
                <div className="field">
                  <label className="field-label">画面描述</label>
                  <textarea rows={4} value={selected.scene}
                    onChange={(e) => patchShot(selected.id, { scene: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">台词 / 旁白</label>
                  <textarea rows={2} value={selected.dialogue || ''}
                    onChange={(e) => patchShot(selected.id, { dialogue: e.target.value })} />
                </div>
                <div className="row2">
                  <div className="field">
                    <label className="field-label">镜头语言</label>
                    <input value={selected.camera || ''} onChange={(e) => patchShot(selected.id, { camera: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label">时长(秒)</label>
                    <input type="number" min="1" max="20" value={selected.duration || 5}
                      onChange={(e) => patchShot(selected.id, { duration: Number(e.target.value) }, true)} />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">视频参数</label>
                  <div className="row2">
                    <select value={Number(selected.duration) || 5} onChange={(e) => saveVideoOpt(selected, { duration: Number(e.target.value) })}>
                      {[5, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                    </select>
                    <select value={selected.ratio || videoOpt.ratio} onChange={(e) => saveVideoOpt(selected, { ratio: e.target.value })}>
                      {['9:16', '16:9', '1:1'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                {!!characters.length && (
                  <div className="field">
                    <label className="field-label">出镜角色（决定形象注入）</label>
                    <div className="chips">
                      {characters.map((c) => (
                        <button key={c.id} className={`chip ${charsOf(selected).includes(c.id) ? 'on' : ''}`}
                          onClick={() => toggleChar(selected, c.id)}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {(variantsMap[selected.id] || []).length > 1 && (
                  <div className="field">
                    <label className="field-label">版本（点选采用）</label>
                    <div className="variant-strip" style={{ padding: 0 }}>
                      {(variantsMap[selected.id] || []).map((v, i, arr) => (
                        <button key={v.id} className={`variant ${selected.image_url === v.image_url ? 'on' : ''}`}
                          onClick={() => selectVariant(selected, v.id)}>
                          <img src={v.image_url} alt="" /><span>{arr.length - i}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selected.prompt_used && (
                  <details className="adv">
                    <summary>实际使用的提示词</summary>
                    <div className="hint" style={{ whiteSpace: 'pre-wrap' }}>{selected.prompt_used}</div>
                  </details>
                )}

                {selected.error && <div className="err-box">{selected.error}</div>}
              </div>

              <div className="insp-foot">
                <button className="primary" onClick={() => genOne(selected)} disabled={selected.status === 'running' || selected.status === 'video'}>
                  {selected.image_url ? '重生成图' : '生成分镜图'}
                </button>
                <button onClick={() => genVideo(selected)} disabled={!selected.image_url || selected.status === 'video' || selected.status === 'running'}>
                  {selected.video_url ? '重生成视频' : '图生视频'}
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
