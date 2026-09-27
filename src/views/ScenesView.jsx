import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

export default function ScenesView() {
  const { script, styleId, modelGroups, notify } = useApp();
  const [scenes, setScenes] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!script) return setScenes([]);
    api.listScenes(script.id).then(setScenes).catch(() => setScenes([]));
  }, [script?.id]);

  const extract = async () => {
    if (!script) return;
    setBusy('extract');
    try {
      const result = await api.extractScenes(script.id, { modelId: modelGroups?.text?.[0]?.id });
      setScenes(result.scenes || await api.listScenes(script.id));
      notify(`已识别 ${result.created || 0} 个场景`);
    } catch (e) { notify(`提取场景失败：${e.message}`, true); } finally { setBusy(''); }
  };

  const add = async () => {
    try { const scene = await api.createScene({ scriptId: script.id, name: `场景 ${scenes.length + 1}` }); setScenes((list) => [...list, scene]); }
    catch (e) { notify(`新建场景失败：${e.message}`, true); }
  };

  const patchScene = async (id, patch) => {
    setScenes((list) => list.map((scene) => scene.id === id ? { ...scene, ...patch } : scene));
    try { await api.updateScene(id, patch); } catch (e) { notify(`保存场景失败：${e.message}`, true); }
  };

  const remove = async (scene) => {
    if (!window.confirm(`删除场景「${scene.name}」？`)) return;
    try { await api.deleteScene(scene.id); setScenes((list) => list.filter((item) => item.id !== scene.id)); }
    catch (e) { notify(`删除场景失败：${e.message}`, true); }
  };

  const generate = async (scene) => {
    setBusy(scene.id);
    try {
      const result = await api.sceneImage(scene.id, { styleId: styleId || undefined, modelId: modelGroups?.image?.[0]?.id });
      setScenes((list) => list.map((item) => item.id === scene.id ? { ...item, ref_image_url: result.ref_image_url } : item));
      notify(`已生成场景图「${scene.name}」`);
    } catch (e) { notify(`场景出图失败：${e.message}`, true); } finally { setBusy(''); }
  };

  return (
    <div className="view-body scene-workspace">
      <div className="view-bar scene-toolbar"><span className="pill">场景库 · 空间、环境与光影保持一致</span><div className="spacer" /><button onClick={extract} disabled={!!busy}>{busy === 'extract' ? '识别中…' : '从剧本提取场景'}</button><button className="primary" onClick={add}>＋ 新建场景</button></div>
      {!scenes.length && <div className="empty-card"><h3>还没有场景档案</h3><p className="hint">从剧本提取场景，或手动创建一个空间描述，分镜会自动引用。</p></div>}
      <div className="scene-grid">
        {scenes.map((scene) => (
          <div className="scene-card" key={scene.id}>
            <div className="scene-image">{scene.ref_image_url ? <img src={scene.ref_image_url} alt={scene.name} /> : <span className="hint">场景图未生成</span>}</div>
            <div className="scene-body">
              <input value={scene.name || ''} placeholder="场景名称" onChange={(e) => patchScene(scene.id, { name: e.target.value })} />
              <textarea rows={3} value={scene.env || ''} placeholder="环境、时间、光影、材质和氛围" onChange={(e) => patchScene(scene.id, { env: e.target.value })} />
              <textarea rows={2} value={scene.prompt || ''} placeholder="场景生成提示词（可选）" onChange={(e) => patchScene(scene.id, { prompt: e.target.value })} />
            </div>
            <div className="shot-foot"><button className="primary" onClick={() => generate(scene)} disabled={!!busy}>{busy === scene.id ? '生成中…' : scene.ref_image_url ? '重做场景图' : '生成场景图'}</button><button className="ghost tiny" onClick={() => remove(scene)}>删除</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
