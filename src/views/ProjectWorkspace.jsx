import { useState } from 'react';
import { useApp } from '../context.js';
import ScriptView from './ScriptView.jsx';
import StoryboardView from './StoryboardView.jsx';
import CharactersView from './CharactersView.jsx';
import StylesView from './StylesView.jsx';
import ScenesView from './ScenesView.jsx';
import MediaView from './MediaView.jsx';

const TABS = [
  { key: 'script', label: '剧本' },
  { key: 'assets', label: '资产' },
  { key: 'storyboard', label: '分镜' },
  { key: 'output', label: '成片' },
];

export default function ProjectWorkspace() {
  const { script, projectTab, setProjectTab, openProject, openProjects } = useApp();
  const [assetTab, setAssetTab] = useState('characters');

  if (!script) return null;

  return (
    <div className="project-workspace">
      <div className="workspace-head">
        <div className="workspace-title">
          <span className="workspace-kicker">项目工作区</span>
          <h2>{script.title}</h2>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="项目工作区">
          {TABS.map((tab) => (
            <button key={tab.key} role="tab" aria-selected={projectTab === tab.key}
              className={projectTab === tab.key ? 'active' : ''} onClick={() => setProjectTab(tab.key)}>{tab.label}</button>
          ))}
        </div>
        <div className="workspace-actions"><button className="ghost" onClick={openProjects}>所有项目</button><button className="ghost workspace-canvas" onClick={() => openProject(script.id, 'storyboard')}>打开分镜 →</button></div>
      </div>

      <div className="workspace-body">
        {projectTab === 'script' && <ScriptView />}
        {projectTab === 'assets' && (
          <div className="asset-workspace">
            <div className="subtabs" role="tablist" aria-label="资产分类">
              <button className={assetTab === 'characters' ? 'active' : ''} onClick={() => setAssetTab('characters')}>角色</button>
              <button className={assetTab === 'scenes' ? 'active' : ''} onClick={() => setAssetTab('scenes')}>场景</button>
              <button className={assetTab === 'styles' ? 'active' : ''} onClick={() => setAssetTab('styles')}>统一风格</button>
            </div>
            {assetTab === 'characters' && <CharactersView />}
            {assetTab === 'scenes' && <ScenesView />}
            {assetTab === 'styles' && <StylesView />}
          </div>
        )}
        {projectTab === 'storyboard' && <StoryboardView />}
        {projectTab === 'output' && <MediaView />}
      </div>
    </div>
  );
}
