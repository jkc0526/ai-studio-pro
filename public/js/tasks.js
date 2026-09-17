// ============ tasks.js ============

// ===== 全局变量 =====
let tasks = []; // each task: {id, type:'image'|'video', status:'completed'|'generating'|'failed', src, prompt, time, seed, model, specs:{}, projectId, error, progress, backendTaskId, params:{}, favorite:false}
let currentTask = null; // currently generating task
let editingTaskId = null; // when editing an existing task's params
let batchMode = false;
let batchResults = [];
let filters = {status:'all', sort:'desc', perPage:10, page:1, selected:new Set()};
let searchQuery = ''; // 搜索关键词

// ===== 图片生成 =====
async function generateImage(){
  if(!currentModel||!currentTask){ showToast('生成错误: 无当前任务','error'); return; }
  const key=getApiKey();
  if(!key){ showToast('请先输入 API Key','error'); currentTask.status='failed'; currentTask.error='未设置API Key'; saveTasks(); renderTaskList(); return; }
  const prompt=currentTask.prompt;
  if(!prompt){ showToast('请输入 Prompt','error'); currentTask.status='failed'; currentTask.error='Prompt为空'; saveTasks(); renderTaskList(); return; }
  setGenerating(true);
  try{
    const body={ model:currentModel.modelId, prompt, size:currentTask.params.size, aspect_ratio:currentTask.params.aspect_ratio };
    const imgs=currentTask.params.images||[];
    if(imgs.length) body.images=imgs;
    const neg=currentTask.params.negative_prompt;
    if(neg) body.negative_prompt=neg;
    const seed=currentTask.params.seed;
    if(seed) body.seed=seed;
    let resp=await fetch('/api/images/generations',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    const respText=await resp.text();
    let data; try{ data=JSON.parse(respText); }catch(e){ throw new Error(respText||`HTTP ${resp.status}`); }
    if(!resp.ok){ const errMsg=data?.error?.message||data?.detail||data?.message||respText||`HTTP ${resp.status}`; throw new Error(errMsg); }
    // Extract URL from response
    let imgUrl=extractMediaUrl(data,'image');
    if(imgUrl){
      await completeTaskWithMedia(currentTask,imgUrl);
      return;
    }
    // Poll if task_id present
    if(data.task_id||data.id||data.request_id){
      currentTask.backendTaskId=data.task_id||data.id||data.request_id;
      saveTasks();
      let pollCount=0;
      while(true){
        pollCount++;
        if(pollCount>120) throw new Error('生成超时');
        currentTask.progress=Math.min(90,pollCount/120*90);
        renderTaskList();
        await new Promise(r=>setTimeout(r,3000));
        const pid=data.task_id||data.id||data.request_id;
        const pollResp=await fetch(`/api/tasks/${pid}`,{headers:{'Authorization':'Bearer '+key}});
        const pollText=await pollResp.text();
        try{ data=JSON.parse(pollText); }catch(e){ continue; }
        if(isTaskCompleted(data)){
          imgUrl=extractMediaUrl(data,'image');
          if(imgUrl){ await completeTaskWithMedia(currentTask,imgUrl); return; }
          if(pollCount<115) continue;
        }
        if(isTaskFailed(data)) throw new Error(data.error?.message||data.error||'生成失败');
      }
    }
    throw new Error('未获取到图片结果');
  }catch(e){
    showToast('生成失败: '+e.message,'error');
    if(currentTask){
      currentTask.status='failed';
      currentTask.error=e.message;
      saveTasks();
      renderTaskList();
    }
  }
  finally{ setGenerating(false); currentTask=null; }
}

// Helper: download media to local and complete task
async function completeTaskWithMedia(task,srcUrl){
  let localSrc=srcUrl;
  if(srcUrl&&!srcUrl.startsWith('/media/')&&!srcUrl.startsWith('/tmp/')&&!srcUrl.startsWith('blob:')){
    try{
      const resp=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:srcUrl,type:task.type})});
      const data=await resp.json();
      if(data.success&&data.url) localSrc=data.url;
    }catch(e){ console.error('Download failed:',e); }
  }
  task.status='completed';
  task.src=localSrc;
  task.progress=100;
  lastSeed=task.seed;
  saveTasks();
  renderTaskList();
}

// Helper: download media via backend proxy (avoids CORS)
async function downloadMedia(url, filename){
  try{
    if(url.startsWith('/media/') || url.startsWith('/tmp/')){
      const a=document.createElement('a');
      a.href=url; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return;
    }
    const resp=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,filename})});
    const data=await resp.json();
    if(data.success && data.url){
      const a=document.createElement('a');
      a.href=data.url; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }else{
      throw new Error(data.error?.message||'下载失败');
    }
  }catch(e){
    showToast('下载失败: '+e.message,'error');
  }
}

// ===== 视频生成 =====
async function generateVideo(){
  if(!currentModel||!currentTask){ showToast('生成错误: 无当前任务','error'); return; }
  const key=getApiKey();
  if(!key){ showToast('请先输入 API Key','error'); currentTask.status='failed'; currentTask.error='未设置API Key'; saveTasks(); renderTaskList(); return; }
  const prompt=currentTask.prompt;
  if(!prompt){ showToast('请输入 Prompt','error'); currentTask.status='failed'; currentTask.error='Prompt为空'; saveTasks(); renderTaskList(); return; }
  const mode=currentTask.params.mode||'text';
  setGenerating(true);
  try{
    const body={ model:currentModel.modelId, prompt, seconds:String(currentTask.params.seconds), mode, size:currentTask.params.size, aspect_ratio:currentTask.params.aspect_ratio };
    if(mode==='reference'||mode==='keyframe'){
      const imgs=currentTask.params.images||[];
      if(imgs.length) body.images=imgs;
      const auds=currentTask.params.audios||[];
      if(auds.length&&currentModel.supportsAudio) body.audios=auds;
    }
    const neg=currentTask.params.negative_prompt;
    if(neg) body.negative_prompt=neg;
    const seed=currentTask.params.seed;
    if(seed) body.seed=seed;
    let resp=await fetch('/api/videos',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    const respText=await resp.text();
    let data; try{ data=JSON.parse(respText); }catch(e){ throw new Error(respText||`HTTP ${resp.status}`); }
    if(!resp.ok){ const errMsg=data?.error?.message||data?.detail||data?.message||respText||`HTTP ${resp.status}`; throw new Error(errMsg); }
    const videoId=data.task_id||data.id||data.request_id||data.video_id;
    if(videoId){
      currentTask.backendTaskId=videoId;
      saveTasks();
      renderTaskList();
      const url=await pollVideoTask(videoId,key,(p,status)=>{
        currentTask.progress=Math.round(p);
        currentTask.statusText=status;
        renderTaskList();
      });
      await completeTaskWithMedia(currentTask,url);
    } else {
      const url=extractMediaUrl(data,'video');
      if(url){ await completeTaskWithMedia(currentTask,url); }
      else throw new Error('未获取到视频结果');
    }
  }catch(e){
    showToast('生成失败: '+e.message,'error');
    if(currentTask){
      currentTask.status='failed';
      currentTask.error=e.message;
      saveTasks();
      renderTaskList();
    }
  }
  finally{ setGenerating(false); currentTask=null; }
}

// ===== 视频任务轮询 =====
async function pollVideoTask(videoId,apiKey,onProgress){
  const maxRetries=240; /* 最多等12分钟 */
  let lastProgress=0;
  let completedWithoutUrl=0;
  for(let i=0;i<maxRetries;i++){
    await new Promise(r=>setTimeout(r,3000));
    let resp;
    try{
      resp=await fetch(`/api/tasks/${videoId}`,{headers:{'Authorization':'Bearer '+apiKey}});
    }catch(e){
      if(i>5) console.warn('Poll network error',e.message);
      continue;
    }
    const text=await resp.text();
    let data; try{ data=JSON.parse(text); }catch(e){
      if(i>5) console.warn('Poll parse error, attempt',i,text.substring(0,200));
      continue;
    }
    if(!resp.ok){
      if(resp.status===404){ /* Try /api/videos/ endpoint as fallback */
        try{
          const resp2=await fetch(`/api/videos/${videoId}`,{headers:{'Authorization':'Bearer '+apiKey}});
          if(resp2.ok){
            const text2=await resp2.text();
            try{ data=JSON.parse(text2); resp=resp2; }catch(e){ continue; }
          }else continue;
        }catch(e){ continue; }
      }else{
        if(i>3) console.warn('Poll HTTP',resp.status,text.substring(0,200));
        continue;
      }
    }
    /* Log first response for debugging */
    if(i===0) console.log('Poll init response:', JSON.stringify(data).substring(0,300));
    /* Check for URL even before status says completed */
    const earlyUrl=extractMediaUrl(data,'video');
    if(earlyUrl && (data.progress>=99||data.progress_percent>=99||i>20)){
      console.log('Found video URL early:', earlyUrl.substring(0,100));
      return earlyUrl;
    }
    if(isTaskCompleted(data)){
      const url=extractMediaUrl(data,'video');
      if(url){
        console.log('Task completed, URL found:', url.substring(0,100));
        return url;
      }
      /* URL might be in a nested structure, log full response for debugging */
      completedWithoutUrl++;
      console.warn('Task completed but no URL found (attempt '+completedWithoutUrl+'), response keys:', Object.keys(data).join(','));
      console.warn('Full response:', JSON.stringify(data).substring(0,800));
      if(completedWithoutUrl<10) continue; /* Wait a bit more for URL to appear */
      throw new Error('视频已完成但未获取到URL，请查看后台');
    }
    if(isTaskFailed(data)){
      console.warn('Task failed, response:', JSON.stringify(data).substring(0,300));
      throw new Error(data.error?.message||data.error||data.message||data.detail||'生成失败');
    }
    /* Extract progress from various possible fields */
    const apiProgress=data.progress??data.percent??data.progress_percent??data.completion??data.progress_ratio*100??0;
    if(typeof apiProgress==='number' && apiProgress>lastProgress) lastProgress=apiProgress;
    if(onProgress){
      const displayProgress=Math.max(lastProgress,Math.min(90,(i/maxRetries)*100));
      onProgress(displayProgress, data.status||data.state||data.phase||'');
    }
  }
  throw new Error('生成超时（已等待12分钟）');
}

// ===== 任务列表渲染 =====
function renderTaskList(){
  const container=document.getElementById('taskListContainer');

  // Get items based on current view
  let items;
  if(currentView==='drafts'){
    items=drafts.filter(d=>d.projectId===currentProjectId);
  } else {
    items=tasks.filter(t=>t.projectId===currentProjectId);
  }

  // Filter by type (video/image) based on current app view
  if(currentAppView==='images'){
    items=items.filter(t=>t.type==='image');
  } else if(currentAppView==='tasks'){
    items=items.filter(t=>t.type==='video');
  }

  // Apply status filter (only for tasks view)
  if(currentView==='tasks' && filters.status!=='all'){
    items=items.filter(t=>t.status===filters.status);
  }

  // Apply search filter (按 prompt 内容搜索)
  if(searchQuery && searchQuery.trim()){
    const q=searchQuery.trim().toLowerCase();
    items=items.filter(t=>(t.prompt||'').toLowerCase().includes(q));
  }

  // Apply sort
  if(filters.sort==='desc'){
    items.sort((a,b)=>new Date(b.time)-new Date(a.time));
  } else {
    items.sort((a,b)=>new Date(a.time)-new Date(b.time));
  }

  // Pagination
  const total=items.length;
  const totalPages=Math.max(1,Math.ceil(total/filters.perPage));
  if(filters.page>totalPages) filters.page=totalPages;
  const start=(filters.page-1)*filters.perPage;
  const pageItems=items.slice(start,start+filters.perPage);

  // Update task count badge
  const badge=document.getElementById('taskCountBadge');
  let projectTasks=tasks.filter(t=>t.projectId===currentProjectId);
  if(currentAppView==='images') projectTasks=projectTasks.filter(t=>t.type==='image');
  else if(currentAppView==='tasks') projectTasks=projectTasks.filter(t=>t.type==='video');
  badge.textContent=`任务列表(${projectTasks.length})`;

  // Update stats
  updateStats();

  // Render
  if(!pageItems.length){
    container.innerHTML=`<div class="task-empty"><div class="empty-icon">${currentView==='drafts'?'📝':'📋'}</div><p>${currentView==='drafts'?'暂无暂存任务':'暂无任务，点击"创建任务"开始'}</p></div>`;
    document.getElementById('pagination').style.display='none';
    return;
  }

  container.innerHTML=pageItems.map(t=>currentView==='drafts'?renderDraftCard(t):renderTaskCard(t)).join('');
  document.getElementById('pagination').style.display=totalPages>1?'flex':'none';
  renderPagination(totalPages);
}

// ===== 渲染单个任务卡片 =====
function renderTaskCard(task){
  const statusInfo={
    completed:{text:'已完成',cls:'status-completed'},
    generating:{text:'生成中',cls:'status-generating'},
    failed:{text:'失败',cls:'status-failed'}
  };
  const si=statusInfo[task.status]||statusInfo.completed;
  const isImg=task.type==='image';
  const thumb=task.src
    ?(isImg?`<img src="${esc(task.src)}" alt="" />`:`<video src="${esc(task.src)}" muted></video>`)
    :`<div class="task-thumb-placeholder">${isImg?'🖼':'🎬'}</div>`;

  const specsParts=[];
  if(task.specs?.modelName) specsParts.push(['渠道',task.specs.modelName]);
  if(task.specs?.size) specsParts.push(['分辨率',task.specs.size]);
  if(task.specs?.ratio) specsParts.push(['比例',task.specs.ratio]);
  if(task.specs?.duration) specsParts.push(['时长',task.specs.duration+'s']);
  if(task.specs?.mode) specsParts.push(['模式',task.specs.mode]);
  const specsHtml=specsParts.map(([k,v])=>`<span class="spec-item">${k}: ${esc(v)}</span>`).join('');

  const isSelected=filters.selected.has(task.id);
  const expanded=task._expanded;
  const isFavorite=task.favorite===true;

  let detailHtml='';
  if(expanded){
    const mediaHtml=task.src
      ?(isImg?`<img src="${esc(task.src)}" alt="result" />`:`<video src="${esc(task.src)}" controls autoplay loop></video>`)
      :(task.status==='generating'
        ?`<div style="padding:20px;color:var(--muted);text-align:center"><div class="task-progress-bar"><div class="task-progress-fill" style="width:${task.progress||0}%"></div></div><p style="margin-top:8px">生成中 ${task.progress||0}%</p></div>`
        :`<div style="padding:20px;color:var(--error);text-align:center">生成失败: ${esc(task.error||'未知错误')}</div>`);
    detailHtml=`
      <div class="task-detail">
        <div class="task-detail-media">${mediaHtml}</div>
        ${task.src?`<div style="text-align:center;margin-top:8px"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();downloadMedia('${esc(task.src)}','${task.type}_${task.id}')">下载</button></div>`:''}
        <div class="task-detail-meta">
          <div class="meta-row"><span class="meta-label">模型</span><span class="meta-val">${esc(task.model||task.specs?.modelName||'')}</span></div>
          <div class="meta-row"><span class="meta-label">类型</span><span class="meta-val">${isImg?'图片':'视频'}</span></div>
          <div class="meta-row"><span class="meta-label">时间</span><span class="meta-val">${esc(formatTime(task.time))}</span></div>
          <div class="meta-row"><span class="meta-label">Seed</span><span class="meta-val">${task.seed?esc(task.seed):'随机'}</span></div>
          <div class="meta-row" style="grid-column:1/-1"><span class="meta-label">Prompt</span><span class="meta-val">${esc(task.prompt)}</span></div>
          ${task.error?`<div class="meta-row" style="grid-column:1/-1"><span class="meta-label">错误</span><span class="meta-val" style="color:var(--error)">${esc(task.error)}</span></div>`:''}
        </div>
      </div>`;
  }

  return `
  <div class="task-card${expanded?' expanded':''}" id="card-${task.id}">
    <div class="task-card-header" onclick="toggleTaskExpand('${task.id}')">
      <input type="checkbox" class="task-checkbox" ${isSelected?'checked':''} onclick="event.stopPropagation();toggleTaskSelect('${task.id}',this.checked)" />
      <span class="task-favorite" onclick="event.stopPropagation();toggleTaskFavorite('${task.id}')" style="cursor:pointer;font-size:16px;flex-shrink:0;">${isFavorite?'⭐':'☆'}</span>
      <span class="task-status ${si.cls}">${si.text}${task.status==='generating'&&task.progress?' '+task.progress+'%':''}</span>
      <span class="task-time">${esc(formatTime(task.time))}</span>
      <span class="task-id">#${esc(task.id.substring(0,20))}</span>
      <span class="task-expand-icon">▼</span>
    </div>
    ${task.status==='generating'&&task.progress?`<div style="height:3px;background:var(--border);margin:0 12px"><div style="height:100%;width:${task.progress}%;background:var(--accent);transition:width .3s"></div></div>`:''}
    <div class="task-card-body">
      <div class="task-thumb">${thumb}</div>
      <div class="task-info">
        <div class="task-prompt">${esc(task.prompt)}</div>
        <div class="task-specs">${specsHtml}</div>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn btn-sm" onclick="event.stopPropagation();resubmitTask('${task.id}')">再次提交</button>
      <button class="btn btn-sm" onclick="event.stopPropagation();editTask('${task.id}')">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteTask('${task.id}')">删除</button>
    </div>
    ${detailHtml}
  </div>`;
}

// ===== 渲染暂存卡片 =====
function renderDraftCard(draft){
  const isImg=draft.type==='image';
  const specsParts=[];
  if(draft.specs?.modelName) specsParts.push(['渠道',draft.specs.modelName]);
  if(draft.specs?.size) specsParts.push(['分辨率',draft.specs.size]);
  if(draft.specs?.ratio) specsParts.push(['比例',draft.specs.ratio]);
  if(draft.specs?.duration) specsParts.push(['时长',draft.specs.duration+'s']);
  if(draft.specs?.mode) specsParts.push(['模式',draft.specs.mode]);
  const specsHtml=specsParts.map(([k,v])=>`<span class="spec-item">${k}: ${esc(v)}</span>`).join('');

  return `
  <div class="task-card" id="card-${draft.id}">
    <div class="task-card-header">
      <span class="task-status status-generating">暂存</span>
      <span class="task-time">${esc(formatTime(draft.time))}</span>
      <span class="task-id">#${esc(draft.id.substring(0,20))}</span>
    </div>
    <div class="task-card-body">
      <div class="task-thumb"><div class="task-thumb-placeholder">${isImg?'🖼':'🎬'}</div></div>
      <div class="task-info">
        <div class="task-prompt">${esc(draft.prompt)}</div>
        <div class="task-specs">${specsHtml}</div>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn btn-sm btn-primary" onclick="submitDraft('${draft.id}')">提交</button>
      <button class="btn btn-sm" onclick="editDraft('${draft.id}')">编辑</button>
      <button class="btn btn-sm btn-danger" onclick="deleteDraft('${draft.id}')">删除</button>
    </div>
  </div>`;
}

// ===== 分页渲染 =====
function renderPagination(totalPages){
  const c=document.getElementById('pagination');
  let html='';
  if(filters.page>1) html+=`<button class="btn btn-sm" onclick="goToPage(${filters.page-1})">上一页</button>`;
  html+=`<span class="page-info">第 ${filters.page} / ${totalPages} 页</span>`;
  if(filters.page<totalPages) html+=`<button class="btn btn-sm" onclick="goToPage(${filters.page+1})">下一页</button>`;
  c.innerHTML=html;
}
function goToPage(p){ filters.page=p; renderTaskList(); }

// ===== 展开/收起任务 =====
function toggleTaskExpand(id){
  const task=tasks.find(t=>t.id===id);
  if(!task) return;
  task._expanded=!task._expanded;
  renderTaskList();
}

// ===== 选择任务 =====
function toggleTaskSelect(id,checked){
  if(checked) filters.selected.add(id); else filters.selected.delete(id);
  updateBatchPanel();
  // Update select-all checkbox
  const sa=document.getElementById('selectAllCheckbox');
  if(sa){
    const visible=tasks.filter(t=>t.projectId===currentProjectId);
    const allSelected=visible.length>0&&visible.every(t=>filters.selected.has(t.id));
    sa.checked=allSelected;
  }
}

// ===== 全选 =====
function toggleSelectAll(checked){
  const visible=tasks.filter(t=>t.projectId===currentProjectId);
  if(checked){
    visible.forEach(t=>filters.selected.add(t.id));
  } else {
    filters.selected.clear();
  }
  renderTaskList();
  updateBatchPanel();
}

// ===== 更新批量面板 =====
function updateBatchPanel(){
  const panel=document.getElementById('batchPanel');
  const info=document.getElementById('batchInfo');
  const count=filters.selected.size;
  panel.classList.toggle('open',count>0);
  info.textContent=`已选择 ${count} 个任务`;
}

// ===== 清除选择 =====
function clearSelection(){
  filters.selected.clear();
  document.getElementById('selectAllCheckbox').checked=false;
  renderTaskList();
  updateBatchPanel();
}

// ===== 批量删除 =====
function batchDeleteTasks(){
  if(!filters.selected.size) return;
  if(!confirm(`确定删除 ${filters.selected.size} 个任务?`)) return;
  tasks=tasks.filter(t=>!filters.selected.has(t.id));
  filters.selected.clear();
  saveTasks();
  renderTaskList();
  updateBatchPanel();
  showToast('批量删除完成','success');
}

// ===== 重新提交任务 =====
function resubmitTask(id){
  const task=tasks.find(t=>t.id===id);
  if(!task) return;
  if(isGenerating){ showToast('当前有任务正在生成，请稍候','warn'); return; }
  // Create a new task with same params
  const newTask={
    ...JSON.parse(JSON.stringify(task)),
    id:'task_'+Date.now(),
    status:'generating',
    src:null,
    time:new Date().toISOString(),
    progress:0,
    error:null,
    _expanded:false
  };
  tasks.unshift(newTask);
  saveTasks();
  renderTaskList();
  currentTask=newTask;
  // Find the model
  currentModel=getAllModels().find(m=>m.modelId===task.specs?.modelId)||getAllModels().find(m=>m.id===task.specs?.modelId)||currentModel;
  if(task.type==='image'){
    generateImage();
  } else {
    generateVideo();
  }
}

// ===== 编辑任务 =====
function editTask(id){
  openCreateModal(id);
}

// ===== 删除任务 =====
function deleteTask(id){
  if(!confirm('确定删除此任务?')) return;
  tasks=tasks.filter(t=>t.id!==id);
  filters.selected.delete(id);
  saveTasks();
  renderTaskList();
  updateBatchPanel();
  showToast('任务已删除','success');
}

// ===== 提交暂存 =====
function submitDraft(id){
  const draft=drafts.find(d=>d.id===id);
  if(!draft) return;
  // Find model
  currentModel=getAllModels().find(m=>m.modelId===draft.specs?.modelId)||getAllModels().find(m=>m.id===draft.specs?.modelId)||getAllModels()[0];
  if(!currentModel) return;
  // Build task from draft
  const isImage=currentModel.type==='image';
  const task={
    id:'task_'+Date.now(),
    type:currentModel.type,
    status:'generating',
    src:null,
    prompt:draft.prompt,
    time:new Date().toISOString(),
    seed:draft.seed||null,
    model:draft.specs?.modelName||currentModel.name,
    specs:{...draft.specs},
    projectId:currentProjectId,
    progress:0,
    error:null,
    params:{
      model:currentModel.modelId,
      prompt:draft.prompt,
      size:draft.specs?.size,
      aspect_ratio:draft.specs?.ratio,
      images:[],
      negative_prompt:draft.negPrompt||'',
      seed:draft.seed||null
    }
  };
  if(!isImage){
    task.params.seconds=draft.specs?.duration;
    task.params.mode=draft.specs?.mode;
    task.params.audios=[];
  }
  // Remove draft
  drafts=drafts.filter(d=>d.id!==id);
  saveDrafts();
  // Add task and start generation
  tasks.unshift(task);
  saveTasks();
  currentView='tasks';
  document.getElementById('viewTabTasks').classList.add('active');
  document.getElementById('viewTabDrafts').classList.remove('active');
  renderTaskList();
  currentTask=task;
  if(isImage){
    generateImage();
  } else {
    generateVideo();
  }
}

// ===== 编辑暂存 =====
function editDraft(id){
  const draft=drafts.find(d=>d.id===id);
  if(!draft) return;
  // Open create modal with draft data
  currentModel=getAllModels().find(m=>m.modelId===draft.specs?.modelId)||getAllModels().find(m=>m.id===draft.specs?.modelId)||getAllModels()[0];
  editingTaskId=draft.id; // use as marker for draft editing
  uploadedImages=[];
  uploadedAudios=[];
  lockedSeed=null;
  document.getElementById('createModalTitle').textContent='编辑暂存任务';
  renderCreateModalFields();
  populateCreateModalFromDraft(draft);
  document.getElementById('createModal').classList.add('open');
  // Override save draft to update existing
  // We'll handle this in submitTask/saveDraft by checking editingTaskId in drafts
}

// ===== 删除暂存 =====
function deleteDraft(id){
  if(!confirm('确定删除此暂存任务?')) return;
  drafts=drafts.filter(d=>d.id!==id);
  saveDrafts();
  renderTaskList();
  showToast('暂存任务已删除','success');
}

// ===== 应用筛选 =====
function applyFilters(){
  filters.status=document.getElementById('statusFilter').value;
  filters.sort=document.getElementById('sortSelect').value;
  filters.page=1;
  renderTaskList();
}

// ===== 每页数量变化 =====
function onPerPageChange(){
  filters.perPage=parseInt(document.getElementById('perPageSelect').value);
  filters.page=1;
  renderTaskList();
}

// ===== 刷新任务 =====
function refreshTasks(){
  loadTasks();
  renderTaskList();
  showToast('已刷新','success');
}

// ===== 清理失败任务 =====
function cleanupFailedTasks(){
  const failedCount=tasks.filter(t=>t.status==='failed'&&t.projectId===currentProjectId).length;
  if(!failedCount){ showToast('没有失败任务可清理','warn'); return; }
  if(!confirm(`确定清理 ${failedCount} 个失败任务?`)) return;
  tasks=tasks.filter(t=>!(t.status==='failed'&&t.projectId===currentProjectId));
  saveTasks();
  renderTaskList();
  showToast('已清理失败任务','success');
}

// ===== 更新统计信息 =====
function updateStats(){
  const projectTasks=tasks.filter(t=>t.projectId===currentProjectId);
  const completed=projectTasks.filter(t=>t.status==='completed').length;
  const generating=projectTasks.filter(t=>t.status==='generating').length;
  const failed=projectTasks.filter(t=>t.status==='failed').length;
  const total=projectTasks.length;
  document.getElementById('statsInfo').textContent=`共 ${total} 个 | 已完成 ${completed} | 生成中 ${generating} | 失败 ${failed}`;
}

// ===== 历史迁移 =====
function migrateHistoryToTasks(){
  try{
    const oldHistory=JSON.parse(localStorage.getItem('ai_studio_history')||'[]');
    if(oldHistory.length && !tasks.length){
      tasks=oldHistory.map((h,i)=>{
        const dt=h.time?new Date(h.time):new Date();
        if(isNaN(dt)) h.time=new Date().toISOString();
        else { try{ h.time=new Date(h.time).toISOString(); }catch(e){ h.time=new Date().toISOString(); } }
        return {
          id:'migrated_'+i+'_'+Date.now(),
          type:h.type||'image',
          status:'completed',
          src:h.src,
          prompt:h.prompt||'',
          time:h.time,
          seed:h.seed||null,
          model:'Unknown',
          specs:{},
          projectId:'default',
          progress:100,
          error:null
        };
      });
      localStorage.removeItem('ai_studio_history');
      saveTasks();
      return true;
    }
  }catch(e){ console.warn('Migration failed:',e); }
  return false;
}

// ===== 加载任务 =====
function loadTasks(){
  try{ tasks=JSON.parse(localStorage.getItem('ai_studio_tasks')||'[]'); }catch(e){ tasks=[]; }
  // Migrate old history
  if(!tasks.length) migrateHistoryToTasks();
  // Fetch from backend
  fetch('/api/history').then(r=>r.json()).then(data=>{
    if(data.success&&data.history&&data.history.length>0){
      // Backend stores tasks format (or old history format)
      const backendTasks=data.history.map(h=>{
        if(h.id&&h.status) return h; // already task format
        // Old history format - convert
        return {
          id:h.id||('backend_'+Date.now()+'_'+Math.random().toString(36).substr(2,6)),
          type:h.type||'image',
          status:'completed',
          src:h.src,
          prompt:h.prompt||'',
          time:h.time||new Date().toISOString(),
          seed:h.seed||null,
          model:h.model||'Unknown',
          specs:h.specs||{},
          projectId:h.projectId||'default',
          progress:100,
          error:null
        };
      });
      const backendIds=backendTasks.map(t=>t.id);
      const localOnly=tasks.filter(t=>!backendIds.includes(t.id));
      const merged=[...tasks,...backendTasks.filter(bt=>!tasks.some(t=>t.id===bt.id))];
      // Deduplicate by id, keeping local (newer) versions
      const seen=new Map();
      merged.forEach(t=>{ seen.set(t.id,t); });
      tasks=[...seen.values()].sort((a,b)=>new Date(b.time)-new Date(a.time));
      renderTaskList();
    }
  }).catch(()=>{});
}

// ===== 保存任务 =====
function saveTasks(){
  // Strip non-serializable fields before saving
  const toSave=tasks.map(t=>{
    const copy={...t};
    delete copy._expanded;
    // Don't save large data URIs in params.images/params.audios to localStorage
    if(copy.params){
      const p={...copy.params};
      if(p.images) p.images=p.images.map(()=>null); // placeholder
      if(p.audios) p.audios=p.audios.map(()=>null);
      copy.params=p;
    }
    return copy;
  });
  localStorage.setItem('ai_studio_tasks',JSON.stringify(toSave));
  // Save to backend
  fetch('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({history:toSave})}).catch(()=>{});
}

// ===== 新增：切换任务收藏 =====
function toggleTaskFavorite(id){
  const task=tasks.find(t=>t.id===id);
  if(!task) return;
  task.favorite=!task.favorite;
  saveTasks();
  renderTaskList();
  showToast(task.favorite?'已收藏':'已取消收藏','success');
}

// ===== 新增：搜索任务 =====
function searchTasks(query){
  searchQuery=query||'';
  filters.page=1;
  renderTaskList();
}

// ===== 新增：导出任务为JSON =====
function exportTasks(){
  // 获取当前筛选后的任务列表
  let items=tasks.filter(t=>t.projectId===currentProjectId);

  // Filter by type
  if(currentAppView==='images'){
    items=items.filter(t=>t.type==='image');
  } else if(currentAppView==='tasks'){
    items=items.filter(t=>t.type==='video');
  }

  // Apply status filter
  if(filters.status!=='all'){
    items=items.filter(t=>t.status===filters.status);
  }

  // Apply search filter
  if(searchQuery && searchQuery.trim()){
    const q=searchQuery.trim().toLowerCase();
    items=items.filter(t=>(t.prompt||'').toLowerCase().includes(q));
  }

  if(!items.length){
    showToast('没有可导出的任务','warn');
    return;
  }

  // 构建导出数据（去除内部字段）
  const exportData=items.map(t=>{
    const copy={...t};
    delete copy._expanded;
    if(copy.params){
      const p={...copy.params};
      if(p.images) p.images=p.images.map(()=>null);
      if(p.audios) p.audios=p.audios.map(()=>null);
      copy.params=p;
    }
    return copy;
  });

  const jsonStr=JSON.stringify(exportData,null,2);
  const blob=new Blob([jsonStr],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const timestamp=new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
  a.download=`tasks_export_${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已导出 ${exportData.length} 个任务`,'success');
}

