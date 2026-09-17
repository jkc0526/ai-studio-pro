// ============ modals.js ============

/* ==================== Modal State ==================== */
let uploadedImages = []; // [{dataUri, label, name}]
let uploadedAudios = []; // [{dataUri, label, name}]
let customModels = [];

let mentionState={active:false,start:0,items:[],index:0};

/* ==================== @ Mention System ==================== */
function processPrompt(prompt){
  if(!prompt) return '';
  let result=prompt;
  uploadedImages.forEach((img,i)=>{
    if(img.name){ const re=new RegExp('@'+img.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'); result=result.replace(re,'<Picture '+(i+1)+'>'); }
  });
  uploadedAudios.forEach((aud,i)=>{
    if(aud.name){ const re=new RegExp('@'+aud.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'); result=result.replace(re,'<Audio '+(i+1)+'>'); }
  });
  return result;
}

function updateRefTable(){
  const tbl=document.getElementById('refTable');
  if(!tbl) return;
  const rows=[];
  uploadedImages.forEach((img,i)=>{ if(img.name) rows.push(`<div class="ref-row"><span class="ref-src">@${esc(img.name)}</span><span class="ref-dst">&lt;Picture ${i+1}&gt;</span></div>`); });
  uploadedAudios.forEach((aud,i)=>{ if(aud.name) rows.push(`<div class="ref-row"><span class="ref-src">@${esc(aud.name)}</span><span class="ref-dst">&lt;Audio ${i+1}&gt;</span></div>`); });
  if(rows.length){ tbl.classList.add('open'); tbl.innerHTML='<h4>引用映射</h4>'+rows.join(''); }
  else{ tbl.classList.remove('open'); tbl.innerHTML=''; }
}

function handlePromptInput(e){
  const ta=e.target;
  const caret=ta.selectionStart;
  const text=ta.value.substring(0,caret);
  const at=text.lastIndexOf('@');
  if(at>-1 && at===text.length-1 || (at>-1 && !/\s/.test(text.substring(at+1)))){
    mentionState.active=true; mentionState.start=at;
    mentionState.items=getMentionItems();
    mentionState.index=0;
    if(mentionState.items.length){ showMentionDropdown(ta,mentionState.items); }
    else{ hideMentionDropdown(); mentionState.active=false; }
  } else { hideMentionDropdown(); mentionState.active=false; }
  updateRefTable();
}
function getMentionItems(){
  const items=[];
  uploadedImages.forEach(img=>{ if(img.name) items.push({name:img.name,type:'image',icon:'🖼'}); });
  uploadedAudios.forEach(aud=>{ if(aud.name) items.push({name:aud.name,type:'audio',icon:'🎵'}); });
  return items;
}
function showMentionDropdown(ta,items){
  const dd=document.getElementById('mentionDropdown');
  dd.innerHTML=items.map((it,i)=>`<div class="mention-item${i===0?' active':''}" data-name="${esc(it.name)}"><span class="mi-icon">${it.icon}</span>${esc(it.name)}</div>`).join('');
  const rect=ta.getBoundingClientRect();
  dd.style.top=(rect.bottom+window.scrollY+4)+'px';
  dd.style.left=(rect.left+window.scrollX)+'px';
  dd.classList.add('open');
  dd.querySelectorAll('.mention-item').forEach(el=>{
    el.addEventListener('click',()=>insertMention(el.dataset.name));
  });
}
function hideMentionDropdown(){ document.getElementById('mentionDropdown').classList.remove('open'); }
function insertMention(name){
  const ta=document.getElementById('imgPrompt')||document.getElementById('vidPrompt');
  if(!ta) return;
  const before=ta.value.substring(0,mentionState.start);
  const after=ta.value.substring(ta.selectionStart);
  ta.value=before+'@'+name+' '+after;
  hideMentionDropdown(); mentionState.active=false;
  updateRefTable();
  ta.focus();
}

/* ==================== Keyboard for Mentions ==================== */
document.addEventListener('keydown',e=>{
  if(!mentionState.active) return;
  const dd=document.getElementById('mentionDropdown');
  if(!dd.classList.contains('open')) return;
  if(e.key==='ArrowDown'){ e.preventDefault(); mentionState.index=(mentionState.index+1)%mentionState.items.length; updateMentionActive(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); mentionState.index=(mentionState.index-1+mentionState.items.length)%mentionState.items.length; updateMentionActive(); }
  else if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); const it=mentionState.items[mentionState.index]; if(it) insertMention(it.name); }
  else if(e.key==='Escape'){ hideMentionDropdown(); mentionState.active=false; }
});
function updateMentionActive(){
  document.querySelectorAll('.mention-item').forEach((el,i)=>el.classList.toggle('active',i===mentionState.index));
}

/* ==================== Create Task Modal ==================== */
function openCreateModal(taskId){
  // Clear state
  uploadedImages=[];
  uploadedAudios=[];
  lockedSeed=null;
  lastSeed=null;
  editingTaskId=taskId||null;

  // Determine model: from task being edited, or first available
  let modelToSelect=null;
  if(taskId){
    const task=tasks.find(t=>t.id===taskId);
    if(task){
      modelToSelect=getAllModels().find(m=>m.modelId===task.specs?.modelId)||getAllModels().find(m=>m.id===task.specs?.modelId);
    }
  }
  if(!modelToSelect) modelToSelect=currentModel||getAllModels()[0];
  currentModel=modelToSelect;

  document.getElementById('createModalTitle').textContent=taskId?'编辑任务':'创建任务';
  renderCreateModalFields();
  document.getElementById('createModal').classList.add('open');

  // If editing, populate fields
  if(taskId){
    const task=tasks.find(t=>t.id===taskId);
    if(task) populateCreateModalFromTask(task);
  }
  // If editing a draft, populate from draft
  if(taskId){
    const draft=drafts.find(d=>d.id===taskId);
    if(draft) populateCreateModalFromDraft(draft);
  }
}

function closeCreateModal(){
  document.getElementById('createModal').classList.remove('open');
  editingTaskId=null;
}

function renderCreateModalFields(){
  const body=document.getElementById('createModalBody');
  /* 根据当前页面确定要显示的模型类型 */
  const filterType = (currentAppView==='images') ? 'image' : 'video';
  /* 确保当前模型类型匹配 */
  if(!currentModel || currentModel.type!==filterType){
    currentModel = getAllModels().find(m=>m.type===filterType) || currentModel;
  }
  if(!currentModel){ body.innerHTML='<p style="color:var(--muted);text-align:center;padding:40px">请选择模型</p>'; return; }
  const m=currentModel;
  // Model dropdown - 只显示当前类型的模型，排除chat类型
  const allModels=getAllModels().filter(mm=>mm.type===filterType);
  const presetModels = allModels.filter(mm=>!customModels.some(cm=>cm.id===mm.id));
  const customTypeModels = customModels.filter(mm=>mm.type===filterType);
  const optGroups=`<optgroup label="预设模型">${presetModels.map(mm=>`<option value="${mm.id}" ${mm.id===m.id?'selected':''}>${esc(mm.icon)} ${esc(mm.name)} (${esc(mm.tag||'free')})</option>`).join('')}</optgroup>` +
    (customTypeModels.length?`<optgroup label="自定义模型">${customTypeModels.map(mm=>`<option value="${mm.id}" ${mm.id===m.id?'selected':''}>${esc(mm.icon)} ${esc(mm.name)} (${esc(mm.tag||'custom')})</option>`).join('')}</optgroup>`:'');

  let html=`
    <div class="field">
      <label>模型</label>
      <select id="createModelSelect" onchange="onCreateModelChange()">${optGroups}</select>
    </div>`;

  if(m.type==='image'){
    html+=renderImageModalFields(m);
  } else {
    html+=renderVideoModalFields(m);
  }
  body.innerHTML=html;
  bindUploadEvents();
  updateRefTable();
}

function renderImageModalFields(m){
  const styleOpts=IMAGE_STYLES.map(s=>`<option value="${esc(s.text)}">${esc(s.name)}</option>`).join('');
  const compOpts=IMAGE_COMPOSITIONS.map(c=>`<option value="${esc(c.text)}">${esc(c.name)}</option>`).join('');
  const sizeOpts=m.sizes.map(s=>`<option value="${s}">${s}</option>`).join('');
  const ratioOpts=m.ratios.map(r=>`<option value="${r}">${r}</option>`).join('');
  return `
    <div class="field">
      <label>风格预设</label>
      <select id="imgStyleSelect" onchange="applyStyleOrComp()">${styleOpts}</select>
    </div>
    <div class="field">
      <label>构图/分镜模板</label>
      <select id="imgCompSelect" onchange="applyStyleOrComp()">${compOpts}</select>
    </div>
    <div class="field">
      <label>Prompt（主题描述）</label>
      <div class="prompt-wrap">
        <textarea id="imgPrompt" placeholder="描述你要生成的图片内容，风格和构图会自动添加..." oninput="handlePromptInput(event)"></textarea>
      </div>
      <div class="ref-table" id="refTable"></div>
    </div>
    <div class="field">
      <div class="negative-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>▸</span><span>负向 Prompt</span>
      </div>
      <div class="negative-body"><textarea id="imgNegPrompt" placeholder="不希望出现的内容..."></textarea></div>
    </div>
    <div class="field">
      <label>尺寸 & 比例</label>
      <div class="field-row">
        <select id="imgSize">${sizeOpts}</select>
        <select id="imgRatio">${ratioOpts}</select>
      </div>
    </div>
    ${renderUploadArea('image',m)}
    <div class="field">
      <label>Seed (可选)</label>
      <div class="seed-row">
        <input type="number" id="seedInput" placeholder="留空随机" />
        <button class="btn-lock" id="seedLock" onclick="toggleSeedLock()" title="锁定 Seed">🔓</button>
      </div>
    </div>`;
}

function renderVideoModalFields(m){
  const tplOpts=TEMPLATES.map(t=>`<option value="${esc(t.text)}">${esc(t.name)}</option>`).join('');
  const vStyleOpts=VIDEO_STYLES.map(s=>`<option value="${esc(s.text)}">${esc(s.name)}</option>`).join('');
  const charOpts=CHARACTER_ENHANCERS.map(c=>`<option value="${esc(c.text)}">${esc(c.name)}</option>`).join('');
  const camOpts=CAMERA_MOTIONS.map(c=>`<option value="${esc(c.text)}">${esc(c.name)}</option>`).join('');
  const modeTabs=(m.modes||['text','reference','keyframe']).map(mode=>{
    const labels={text:'文生视频',reference:'参考图',keyframe:'关键帧'};
    return `<div class="mode-tab${mode==='text'?' active':''}" data-mode="${mode}" onclick="selectModeTab(this)">${labels[mode]||mode}</div>`;
  }).join('');
  const durOpts=(m.durations||[4,5,6,7,8]).map(d=>`<option value="${d}">${d}s</option>`).join('');
  const sizeOpts=m.sizes.map(s=>`<option value="${s}">${s}</option>`).join('');
  const ratioOpts=m.ratios.map(r=>`<option value="${r}">${r}</option>`).join('');
  return `
    <div class="field">
      <label>模式</label>
      <div class="mode-tabs">${modeTabs}</div>
    </div>
    <div class="field">
      <label>风格预设</label>
      <select id="vidStyleSelect">${vStyleOpts}</select>
    </div>
    <div class="field">
      <label>Prompt（画面描述）</label>
      <div class="prompt-wrap">
        <textarea id="vidPrompt" placeholder="描述你要生成的视频内容... 风格/运镜/角色一致会自动添加" oninput="handlePromptInput(event)"></textarea>
      </div>
      <div class="ref-table" id="refTable"></div>
    </div>
    <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div>
        <label style="font-size:12px;margin-bottom:4px">运镜</label>
        <select id="vidCameraSelect" style="font-size:12px">${camOpts}</select>
      </div>
      <div>
        <label style="font-size:12px;margin-bottom:4px">角色一致性</label>
        <select id="vidCharSelect" style="font-size:12px">${charOpts}</select>
      </div>
    </div>
    <div class="field">
      <label>镜头模板</label>
      <select id="vidTemplate" onchange="applyTemplate('vid')"><option value="">选择镜头模板...</option>${tplOpts}</select>
    </div>
    <div class="field">
      <div class="negative-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>▸</span><span>负向 Prompt</span>
      </div>
      <div class="negative-body"><textarea id="vidNegPrompt" placeholder="不希望出现的内容..."></textarea></div>
    </div>
    <div class="field">
      <label>时长 & 尺寸 & 比例</label>
      <div class="field-row">
        <select id="vidSeconds">${durOpts}</select>
        <select id="vidSize">${sizeOpts}</select>
        <select id="vidRatio">${ratioOpts}</select>
      </div>
    </div>
    ${renderUploadArea('video',m)}
    <div class="field">
      <label>Seed (可选)</label>
      <div class="seed-row">
        <input type="number" id="seedInput" placeholder="留空随机" />
        <button class="btn-lock" id="seedLock" onclick="toggleSeedLock()" title="锁定 Seed">🔓</button>
      </div>
    </div>`;
}

function onCreateModelChange(){
  const sel=document.getElementById('createModelSelect');
  if(!sel) return;
  const id=sel.value;
  currentModel=getAllModels().find(m=>m.id===id);
  renderCreateModalFields();
}

function selectModeTab(el){
  el.parentElement.querySelectorAll('.mode-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  const mode=el.dataset.mode;
  const imgArea=document.getElementById('uploadImageArea');
  const audArea=document.getElementById('uploadAudioArea');
  if(imgArea) imgArea.style.display=(mode==='text')?'none':'';
  if(audArea) audArea.style.display=(mode==='reference'&&currentModel&&currentModel.supportsAudio)?'':'none';
}

function applyTemplate(prefix){
  const sel=document.getElementById(prefix+'Template');
  if(!sel||!sel.value) return;
  const ta=document.getElementById(prefix+'Prompt');
  ta.value=ta.value?ta.value+'\n'+sel.value:sel.value;
  sel.value='';
}

function applyStyleOrComp(){
  /* 风格/构图下拉选择时预览提示，无需额外拼接，提交时自动组合 */
}

/* 组合图片最终prompt：主题 + 风格 + 构图 */
function buildImagePrompt(){
  const theme=val('imgPrompt');
  const styleSel=document.getElementById('imgStyleSelect');
  const compSel=document.getElementById('imgCompSelect');
  const styleText=styleSel?styleSel.value:'';
  const compText=compSel?compSel.value:'';
  const parts=[];
  if(theme) parts.push(theme);
  if(styleText) parts.push(styleText);
  if(compText) parts.push(compText);
  return parts.join(', ');
}

/* 组合视频最终prompt：主题 + 风格 + 运镜 + 角色一致性 */
function buildVideoPrompt(){
  const theme=val('vidPrompt');
  const styleSel=document.getElementById('vidStyleSelect');
  const camSel=document.getElementById('vidCameraSelect');
  const charSel=document.getElementById('vidCharSelect');
  const styleText=styleSel?styleSel.value:'';
  const camText=camSel?camSel.value:'';
  const charText=charSel?charSel.value:'';
  const parts=[];
  if(theme) parts.push(theme);
  if(styleText) parts.push(styleText);
  if(camText) parts.push(camText);
  if(charText) parts.push(charText);
  return parts.join(', ');
}

function populateCreateModalFromTask(task){
  if(task.prompt){
    const ta=document.getElementById(task.type==='image'?'imgPrompt':'vidPrompt');
    if(ta) ta.value=task.prompt;
  }
  if(task.specs){
    if(task.specs.size){ const el=document.getElementById(task.type==='image'?'imgSize':'vidSize'); if(el) el.value=task.specs.size; }
    if(task.specs.ratio){ const el=document.getElementById(task.type==='image'?'imgRatio':'vidRatio'); if(el) el.value=task.specs.ratio; }
    if(task.specs.duration){ const el=document.getElementById('vidSeconds'); if(el) el.value=task.specs.duration; }
    if(task.specs.mode){ const el=document.querySelector(`.mode-tab[data-mode="${task.specs.mode}"]`); if(el) selectModeTab(el); }
    if(task.specs.negPrompt){ const negEl=document.getElementById(task.type==='image'?'imgNegPrompt':'vidNegPrompt'); if(negEl){ negEl.value=task.specs.negPrompt; negEl.closest('.negative-body')?.classList.add('open'); } }
  }
  if(task.seed){ const el=document.getElementById('seedInput'); if(el) el.value=task.seed; }
}

function populateCreateModalFromDraft(draft){
  if(draft.prompt){
    const ta=document.getElementById(draft.type==='image'?'imgPrompt':'vidPrompt');
    if(ta) ta.value=draft.prompt;
  }
  if(draft.negPrompt){
    const negEl=document.getElementById(draft.type==='image'?'imgNegPrompt':'vidNegPrompt');
    if(negEl){ negEl.value=draft.negPrompt; negEl.closest('.negative-body')?.classList.add('open'); }
  }
  if(draft.specs){
    if(draft.specs.size){ const el=document.getElementById(draft.type==='image'?'imgSize':'vidSize'); if(el) el.value=draft.specs.size; }
    if(draft.specs.ratio){ const el=document.getElementById(draft.type==='image'?'imgRatio':'vidRatio'); if(el) el.value=draft.specs.ratio; }
    if(draft.specs.duration){ const el=document.getElementById('vidSeconds'); if(el) el.value=draft.specs.duration; }
    if(draft.specs.mode){ const el=document.querySelector(`.mode-tab[data-mode="${draft.specs.mode}"]`); if(el) selectModeTab(el); }
  }
  if(draft.seed){ const el=document.getElementById('seedInput'); if(el) el.value=draft.seed; }
}

/* ==================== Upload Handlers ==================== */
function renderUploadArea(type,m){
  const imgArea=`
  <div class="field">
    <label>参考图片</label>
    <div class="upload-area" id="uploadImageArea" onclick="document.getElementById('imageFileInput').click()">
      <div class="upload-icon">🖼</div>
      <div class="upload-hint">点击或拖拽上传图片</div>
      <input type="file" id="imageFileInput" accept="image/*" multiple style="display:none" onchange="handleImageUpload(event)" />
    </div>
    <div class="upload-cards" id="imageCards"></div>
  </div>`;
  const audArea=(type==='video'&&m.supportsAudio)?`
  <div class="field" id="uploadAudioSection">
    <label>参考音频</label>
    <div class="upload-area" id="uploadAudioArea" onclick="document.getElementById('audioFileInput').click()">
      <div class="upload-icon">🎵</div>
      <div class="upload-hint">点击或拖拽上传音频 (MP3/WAV)</div>
      <input type="file" id="audioFileInput" accept="audio/*" multiple style="display:none" onchange="handleAudioUpload(event)" />
    </div>
    <div class="upload-cards" id="audioCards"></div>
  </div>`:'';
  return imgArea+audArea;
}
function bindUploadEvents(){
  const imgArea=document.getElementById('uploadImageArea');
  if(imgArea){
    imgArea.addEventListener('dragover',e=>{e.preventDefault();imgArea.classList.add('dragover');});
    imgArea.addEventListener('dragleave',()=>imgArea.classList.remove('dragover'));
    imgArea.addEventListener('drop',e=>{e.preventDefault();imgArea.classList.remove('dragover');handleImageFiles(e.dataTransfer.files);});
  }
  const audArea=document.getElementById('uploadAudioArea');
  if(audArea){
    audArea.addEventListener('dragover',e=>{e.preventDefault();audArea.classList.add('dragover');});
    audArea.addEventListener('dragleave',()=>audArea.classList.remove('dragover'));
    audArea.addEventListener('drop',e=>{e.preventDefault();audArea.classList.remove('dragover');handleAudioFiles(e.dataTransfer.files);});
  }
  renderImageCards(); renderAudioCards();
}
function handleImageUpload(e){ handleImageFiles(e.target.files); e.target.value=''; }
function handleAudioUpload(e){ handleAudioFiles(e.target.files); e.target.value=''; }
function handleImageFiles(files){
  [...files].forEach(file=>{
    const reader=new FileReader();
    reader.onload=ev=>{
      uploadedImages.push({dataUri:ev.target.result,label:file.name,name:file.name.replace(/\.[^.]+$/,'')});
      renderImageCards(); updateRefTable();
    };
    reader.readAsDataURL(file);
  });
}
function handleAudioFiles(files){
  [...files].forEach(file=>{
    const reader=new FileReader();
    reader.onload=ev=>{
      uploadedAudios.push({dataUri:ev.target.result,label:file.name,name:file.name.replace(/\.[^.]+$/,'')});
      renderAudioCards(); updateRefTable();
    };
    reader.readAsDataURL(file);
  });
}
function renderImageCards(){
  const c=document.getElementById('imageCards');
  if(!c) return;
  c.innerHTML=uploadedImages.map((img,i)=>{
    const imgIdx=uploadedImages.indexOf(img)+1;
    return `<div class="upload-card">
      <img src="${img.dataUri}" alt="${esc(img.name)}" />
      <input type="text" class="card-name" value="${esc(img.name)}" oninput="updateImageName(${i},this.value)" placeholder="名称" />
      <div class="card-mention">@${esc(img.name)} → &lt;Picture ${imgIdx}&gt;</div>
      <button class="btn-remove" onclick="removeImage(${i})">&times;</button>
    </div>`;
  }).join('');
}
function renderAudioCards(){
  const c=document.getElementById('audioCards');
  if(!c) return;
  c.innerHTML=uploadedAudios.map((aud,i)=>{
    const audIdx=uploadedAudios.indexOf(aud)+1;
    return `<div class="upload-card">
      <audio src="${aud.dataUri}" controls style="height:40px"></audio>
      <input type="text" class="card-name" value="${esc(aud.name)}" oninput="updateAudioName(${i},this.value)" placeholder="名称" />
      <div class="card-mention">@${esc(aud.name)} → &lt;Audio ${audIdx}&gt;</div>
      <button class="btn-remove" onclick="removeAudio(${i})">&times;</button>
    </div>`;
  }).join('');
}
function updateImageName(i,name){ uploadedImages[i].name=name; renderImageCards(); updateRefTable(); }
function updateAudioName(i,name){ uploadedAudios[i].name=name; renderAudioCards(); updateRefTable(); }
function removeImage(i){ uploadedImages.splice(i,1); renderImageCards(); updateRefTable(); }
function removeAudio(i){ uploadedAudios.splice(i,1); renderAudioCards(); updateRefTable(); }

/* ==================== Seed Lock ==================== */
function toggleSeedLock(){
  const btn=document.getElementById('seedLock');
  const input=document.getElementById('seedInput');
  if(lockedSeed!==null){
    lockedSeed=null; btn.textContent='🔓'; btn.classList.remove('locked');
    input.disabled=false;
  } else {
    const s=input.value.trim();
    lockedSeed=s||Math.floor(Math.random()*1000000);
    if(!s) input.value=lockedSeed;
    btn.textContent='🔒'; btn.classList.add('locked');
    input.disabled=true;
  }
}

/* ==================== Submit Task ==================== */
function submitTask(){
  if(!currentModel){ showToast('请先选择模型','error'); return; }
  const key=getApiKey();
  if(!key){ showToast('请先输入 API Key','error'); return; }
  const isImage=currentModel.type==='image';
  let prompt;
  if(isImage){
    prompt=processPrompt(buildImagePrompt());
  }else{
    prompt=processPrompt(buildVideoPrompt());
  }
  if(!prompt){ showToast('请输入 Prompt','error'); return; }
  if(isGenerating){ showToast('当前有任务正在生成，请稍候','warn'); return; }

  // Build specs
  let specs={ modelId:currentModel.modelId, modelName:currentModel.name, type:currentModel.type };
  let seed=getSeedValue();
  if(isImage){
    specs.size=val('imgSize');
    specs.ratio=val('imgRatio');
    specs.negPrompt=getNegPrompt('imgNegPrompt');
  } else {
    specs.mode=document.querySelector('.mode-tab.active')?.dataset.mode||'text';
    specs.duration=val('vidSeconds');
    specs.size=val('vidSize');
    specs.ratio=val('vidRatio');
    specs.negPrompt=getNegPrompt('vidNegPrompt');
    specs.supportsAudio=currentModel.supportsAudio;
  }
  if(seed) specs.seed=seed;

  // Create task
  const task={
    id:'task_'+Date.now(),
    type:currentModel.type,
    status:'generating',
    src:null,
    prompt:prompt,
    time:new Date().toISOString(),
    seed:seed||null,
    model:currentModel.name,
    specs:specs,
    projectId:currentProjectId,
    progress:0,
    error:null,
    params:{
      model:currentModel.modelId,
      prompt:prompt,
      size:specs.size,
      aspect_ratio:specs.ratio,
      images:uploadedImages.map(i=>i.dataUri),
      negative_prompt:specs.negPrompt||'',
      seed:seed||null
    }
  };
  if(!isImage){
    task.params.seconds=specs.duration;
    task.params.mode=specs.mode;
    task.params.audios=(specs.mode!=='text'&&currentModel.supportsAudio)?uploadedAudios.map(a=>a.dataUri):[];
  }

  // If editing, remove old task
  if(editingTaskId){
    const idx=tasks.findIndex(t=>t.id===editingTaskId);
    if(idx>-1) tasks.splice(idx,1);
    editingTaskId=null;
  }

  tasks.unshift(task);
  saveTasks();
  closeCreateModal();
  // Switch to task list view
  currentView='tasks';
  document.getElementById('viewTabTasks').classList.add('active');
  document.getElementById('viewTabDrafts').classList.remove('active');
  renderTaskList();

  // Start generation
  currentTask=task;
  if(isImage){
    generateImage();
  } else {
    generateVideo();
  }
}

/* ==================== Save Draft ==================== */
function saveDraft(){
  if(!currentModel){ showToast('请先选择模型','error'); return; }
  const isImage=currentModel.type==='image';
  const prompt=val(isImage?'imgPrompt':'vidPrompt');
  if(!prompt){ showToast('请输入 Prompt','error'); return; }

  let specs={ modelId:currentModel.modelId, modelName:currentModel.name, type:currentModel.type };
  let seed=getSeedValue();
  if(isImage){
    specs.size=val('imgSize');
    specs.ratio=val('imgRatio');
    specs.negPrompt=getNegPrompt('imgNegPrompt');
  } else {
    specs.mode=document.querySelector('.mode-tab.active')?.dataset.mode||'text';
    specs.duration=val('vidSeconds');
    specs.size=val('vidSize');
    specs.ratio=val('vidRatio');
    specs.negPrompt=getNegPrompt('vidNegPrompt');
  }
  if(seed) specs.seed=seed;

  const draft={
    id:'draft_'+Date.now(),
    type:currentModel.type,
    prompt:prompt,
    negPrompt:specs.negPrompt||'',
    specs:specs,
    seed:seed||null,
    time:new Date().toISOString(),
    projectId:currentProjectId,
    images:uploadedImages.map(i=>({name:i.name})),
    audios:uploadedAudios.map(a=>({name:a.name}))
  };

  drafts.unshift(draft);
  saveDrafts();
  closeCreateModal();
  showToast('已保存到暂存列表','success');
}

/* ==================== Custom Models ==================== */
function loadCustomModels(){
  try{ customModels=JSON.parse(localStorage.getItem('custom_models')||'[]'); }catch(e){ customModels=[]; }
  /* 合并 YanBa API 内置聊天模型 */
  YANBA_MODELS.forEach(m=>{
    if(!customModels.some(cm=>cm.id===m.id)) customModels.push(m);
  });
}
function saveCustomModels(){
  localStorage.setItem('custom_models',JSON.stringify(customModels));
}
function openModelModal(){
  document.getElementById('modalTitle').textContent='自定义模型';
  document.getElementById('cmId').value='';
  document.getElementById('cmName').value='';
  document.getElementById('cmModelId').value='';
  document.getElementById('cmType').value='image';
  document.getElementById('cmTag').value='free';
  document.getElementById('cmIcon').value='🤖';
  document.getElementById('cmApiBase').value='';
  document.getElementById('cmSizes').value='1K,2K,4K';
  document.getElementById('cmRatios').value='1:1,16:9,9:16,4:3,3:4';
  document.getElementById('cmMaxImages').value=5;
  document.getElementById('cmDurations').value='4,5,6,7,8,9,10,11,12';
  document.getElementById('cmVSizes').value='720P,960P,2K';
  document.getElementById('cmVRatios').value='16:9,9:16,4:3,1:1';
  document.getElementById('cmAudio').checked=true;
  document.getElementById('cmVideoRef').checked=false;
  document.querySelectorAll('.cmMode').forEach(cb=>cb.checked=true);
  toggleCmFields();
  renderCustomModelList();
  document.getElementById('modelModal').classList.add('open');
}
function closeModelModal(){ document.getElementById('modelModal').classList.remove('open'); }
function toggleCmFields(){
  const type=document.getElementById('cmType').value;
  document.getElementById('cmImageFields').style.display=type==='image'?'':'none';
  document.getElementById('cmVideoFields').style.display=type==='video'?'':'none';
}
function saveCustomModel(){
  const id=document.getElementById('cmId').value;
  const name=document.getElementById('cmName').value.trim();
  const modelId=document.getElementById('cmModelId').value.trim();
  if(!name||!modelId){ showToast('请填写名称和模型ID','error'); return; }
  const type=document.getElementById('cmType').value;
  const model={
    id:id||('custom-'+Date.now()),
    name, modelId, type,
    tag:document.getElementById('cmTag').value,
    icon:document.getElementById('cmIcon').value.trim()||'🤖',
    desc:type==='image'?'自定义图片模型':'自定义视频模型'
  };
  const apiBase=document.getElementById('cmApiBase').value.trim();
  if(apiBase) model.apiBase=apiBase;
  if(type==='image'){
    model.sizes=document.getElementById('cmSizes').value.split(',').map(s=>s.trim()).filter(Boolean);
    model.ratios=document.getElementById('cmRatios').value.split(',').map(s=>s.trim()).filter(Boolean);
  } else {
    model.modes=[...document.querySelectorAll('.cmMode:checked')].map(cb=>cb.value);
    model.maxImages=parseInt(document.getElementById('cmMaxImages').value)||5;
    model.durations=document.getElementById('cmDurations').value.split(',').map(s=>parseInt(s.trim())).filter(Boolean);
    model.sizes=document.getElementById('cmVSizes').value.split(',').map(s=>s.trim()).filter(Boolean);
    model.ratios=document.getElementById('cmVRatios').value.split(',').map(s=>s.trim()).filter(Boolean);
    model.supportsAudio=document.getElementById('cmAudio').checked;
    model.supportsVideoRef=document.getElementById('cmVideoRef').checked;
  }
  const idx=customModels.findIndex(m=>m.id===model.id);
  if(idx>-1) customModels[idx]=model; else customModels.push(model);
  saveCustomModels();
  if(currentModel&&currentModel.id===model.id) currentModel=model;
  renderCustomModelList();
  showToast('模型已保存','success');
  closeModelModal();
}
function editCustomModel(id){
  const m=customModels.find(cm=>cm.id===id);
  if(!m) return;
  document.getElementById('modalTitle').textContent='编辑模型';
  document.getElementById('cmId').value=m.id;
  document.getElementById('cmName').value=m.name;
  document.getElementById('cmModelId').value=m.modelId;
  document.getElementById('cmType').value=m.type;
  document.getElementById('cmTag').value=m.tag||'free';
  document.getElementById('cmIcon').value=m.icon||'🤖';
  document.getElementById('cmApiBase').value=m.apiBase||'';
  if(m.type==='image'){
    document.getElementById('cmSizes').value=(m.sizes||[]).join(',');
    document.getElementById('cmRatios').value=(m.ratios||[]).join(',');
  } else {
    document.getElementById('cmMaxImages').value=m.maxImages||5;
    document.getElementById('cmDurations').value=(m.durations||[]).join(',');
    document.getElementById('cmVSizes').value=(m.sizes||[]).join(',');
    document.getElementById('cmVRatios').value=(m.ratios||[]).join(',');
    document.getElementById('cmAudio').checked=!!m.supportsAudio;
    document.getElementById('cmVideoRef').checked=!!m.supportsVideoRef;
    document.querySelectorAll('.cmMode').forEach(cb=>cb.checked=(m.modes||[]).includes(cb.value));
  }
  toggleCmFields();
  renderCustomModelList();
  document.getElementById('modelModal').classList.add('open');
}
function deleteCustomModel(id){
  if(!confirm('确定删除此模型?')) return;
  customModels=customModels.filter(m=>m.id!==id);
  saveCustomModels();
  if(currentModel&&currentModel.id===id){ currentModel=getAllModels()[0]; }
  renderCustomModelList();
  showToast('模型已删除','success');
}
function renderCustomModelList(){
  const c=document.getElementById('customModelList');
  if(!customModels.length){ c.innerHTML='<p style="color:var(--muted);font-size:12px">暂无自定义模型</p>'; return; }
  c.innerHTML=customModels.map(m=>`
    <div class="modal-list-item">
      <span>${esc(m.icon)} ${esc(m.name)} <span style="color:var(--muted)">(${esc(m.modelId)})</span></span>
      <span>
        <button class="btn btn-sm" onclick="editCustomModel('${m.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCustomModel('${m.id}')">删除</button>
      </span>
    </div>`).join('');
}
