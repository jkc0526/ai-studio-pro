import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

export default function MediaView() {
  const { notify, script } = useApp();
  const [tab, setTab] = useState('movie');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.media(script?.id).then(setItems).catch((e) => notify(e.message, true)).finally(() => setLoading(false));
  }, [script?.id, notify]);

  const groups = {
    movie: items.filter((m) => m.kind === 'movie'),
    video: items.filter((m) => m.kind === 'video'),
  };
  const list = groups[tab] || [];

  return (
    <>
      <div className="view-bar">
        <span className="pill">素材库{script ? ` · ${script.title}` : ''}</span>
        <div className="sep" />
        <button className={tab === 'movie' ? 'primary' : ''} onClick={() => setTab('movie')}>成片 {groups.movie.length}</button>
        <button className={tab === 'video' ? 'primary' : ''} onClick={() => setTab('video')}>镜头视频 {groups.video.length}</button>
        <div className="spacer" />
        <span className="hint">全部产物存放在 data/outputs/，可直接拷走</span>
      </div>

      <div className="view-body">
        {loading && <div className="hint">加载中…</div>}
        {!loading && !list.length && (
          <div className="empty-card">
            <h3>还没有{tab === 'movie' ? '成片' : '镜头视频'}</h3>
            <p className="hint">到「分镜」页生成视频或点「导出成片」，产物会出现在这里。</p>
          </div>
        )}
        <div className="board" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {list.map((m) => (
            <div className="shot" key={m.id}>
              <video src={m.file_path} controls muted loop playsInline style={{ width: '100%', background: '#000', display: 'block' }} />
              <div className="shot-body">
                <div className="hint">{new Date(m.create_time).toLocaleString('zh-CN')}</div>
                {m.model && <div className="hint">模型：{m.model}</div>}
                {m.duration ? <div className="hint">时长：{Math.round(m.duration)} 秒</div> : null}
              </div>
              <div className="shot-foot">
                <a className="btn" href={m.file_path} download>下载</a>
                {m.kind === 'video' && <a className="btn" href={m.file_path} target="_blank" rel="noreferrer">新窗口打开</a>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
