// ============ app.js ============

/* ==================== App State ==================== */
let currentModel = null;
let projects = [{id:'default', name:'默认项目'}];
let currentProjectId = 'default';
let currentView = 'tasks'; // 'tasks' or 'drafts'
let currentAppView = 'tasks'; // 'chat', 'tasks' (video), 'images'
let drafts = []; // [{id, model, prompt, negPrompt, images, audios, params, time, projectId}]

/* ==================== Project Management ==================== */
function loadProjects(){
  try{
    const saved=JSON.parse(localStorage.getItem('ai_studio_projects')||'null');
    if(saved && Array.isArray(saved) && saved.length) projects=saved;
  }catch(e){ projects=[{id:'default',name:'默认项目'}]; }
  if(!projects.find(p=>p.id===currentProjectId)) currentProjectId=projects[0].id;
}
function saveProjects(){
  localStorage.setItem('ai_studio_projects',JSON.stringify(projects));
}
function renderProjectTabs(){
  const c=document.getElementById('projectTabs');
  c.innerHTML=projects.map(p=>`
    <div class="project-tab${p.id===currentProjectId?' active':''}" data-id="${p.id}">
      <span class="pt-name" onclick="selectProject('${p.id}')">${esc(p.name)}</span>
      <span class="pt-actions">
        <button onclick="renameProject('${p.id}')" title="重命名">✎</button>
        ${p.id!=='default'?`<button onclick="deleteProject('${p.id}')" title="删除">✕</button>`:''}
      </span>
    </div>`).join('') + '<div class="project-add" onclick="createProject()">+ 新建项目</div>';
}
function selectProject(id){
  currentProjectId=id;
  filters.page=1;
  filters.selected.clear();
  renderProjectTabs();
  renderTaskList();
  updateBatchPanel();
}
function createProject(){
  const name=prompt('请输入项目名称:');
  if(!name||!name.trim()) return;
  const p={id:'proj_'+Date.now(),name:name.trim()};
  projects.push(p);
  currentProjectId=p.id;
  saveProjects();
  renderProjectTabs();
  renderTaskList();
  showToast('项目已创建','success');
}
function renameProject(id){
  const p=projects.find(x=>x.id===id);
  if(!p) return;
  const name=prompt('请输入新名称:',p.name);
  if(!name||!name.trim()) return;
  p.name=name.trim();
  saveProjects();
  renderProjectTabs();
  showToast('项目已重命名','success');
}
function deleteProject(id){
  if(id==='default'){ showToast('默认项目不可删除','warn'); return; }
  if(!confirm('确定删除此项目? 关联的任务将一并删除.')) return;
  tasks=tasks.filter(t=>t.projectId!==id);
  drafts=drafts.filter(d=>d.projectId!==id);
  projects=projects.filter(p=>p.id!==id);
  if(currentProjectId===id) currentProjectId='default';
  saveProjects(); saveTasks(); saveDrafts();
  renderProjectTabs();
  renderTaskList();
  showToast('项目已删除','success');
}

function switchAppView(view){
  currentAppView = view;
  const chatView = document.getElementById('chatView');
  const taskView = document.getElementById('taskView');
  const settingsView = document.getElementById('settingsView');
  const topbar = document.querySelector('.topbar');
  document.querySelectorAll('.sidebar-item').forEach(function(el){ el.classList.remove('active'); });
  var sidebarItem = document.querySelector('.sidebar-item[data-view="' + view + '"]');
  if(sidebarItem) sidebarItem.classList.add('active');
  if(view === 'chat'){
    chatView.style.display = '';
    chatView.style.height = 'calc(100vh - 56px)';
    if(taskView) { taskView.style.display = 'none'; }
    if(settingsView) settingsView.style.display = 'none';
    if(topbar) topbar.style.display = '';
  } else if(view === 'settings'){
    if(chatView) { chatView.style.display = 'none'; }
    if(taskView) { taskView.style.display = 'none'; }
    if(topbar) topbar.style.display = 'none';
    if(settingsView){ 
      settingsView.style.display = 'block';
      settingsView.style.height = '100vh';
      initSettingsView();
    }
  } else {
    if(chatView) { chatView.style.display = 'none'; }
    if(settingsView) settingsView.style.display = 'none';
    if(topbar) topbar.style.display = '';
    if(taskView){
      taskView.style.display = '';
      if(view === 'images'){
        var imgModel = getAllModels().find(function(m){ return m.type === 'image'; });
        if(imgModel) currentModel = imgModel;
      } else {
        var vidModel = getAllModels().find(function(m){ return m.type === 'video'; });
        if(vidModel) currentModel = vidModel;
      }
      loadTasks();
      renderProjectTabs();
      filters.page = 1;
      renderTaskList();
    }
  }
}

/* ==================== View Switching ==================== */
function switchView(view){
  currentView=view;
  document.getElementById('viewTabTasks').classList.toggle('active',view==='tasks');
  document.getElementById('viewTabDrafts').classList.toggle('active',view==='drafts');
  filters.page=1;
  renderTaskList();
}

function saveDrafts(){
  localStorage.setItem('ai_studio_drafts',JSON.stringify(drafts));
}
function loadDrafts(){
  try{ drafts=JSON.parse(localStorage.getItem('ai_studio_drafts')||'[]'); }catch(e){ drafts=[]; }
}

/* ==================== Init ==================== */
window.addEventListener('load', async () => {
  // 初始化主题
  if(typeof initTheme === 'function') initTheme();
  
  // 加载 API Key
  if(window.electronAPI && window.electronAPI.getApiKey){
    try{ cachedApiKey=await window.electronAPI.getApiKey()||''; }catch(e){ cachedApiKey=''; }
  }
  const saved=getApiKey();
  if(saved) document.getElementById('apiKey').value=saved;
  
  // 加载数据
  loadCustomModels();
  loadProjects();
  loadDrafts();
  
  // 默认模型
  currentModel = getAllModels().find(m=>m.type==='video') || getAllModels().find(m=>m.type==='image') || getAllModels()[0];
  
  loadTasks();
  renderProjectTabs();
  renderTaskList();
  renderChatModelSelect();
  initUpdater();
  initSettingsView();
  
  // 默认显示视频生成页面
  switchAppView('tasks');
});

// 点击遮罩关闭弹窗
document.addEventListener('click', e => {
  if(e.target.classList.contains('modal-overlay')){
    e.target.classList.remove('open');
  }
});
