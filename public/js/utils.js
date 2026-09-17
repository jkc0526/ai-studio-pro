// ============ utils.js ============

/* ==================== Helpers ==================== */
function val(id){ const el=document.getElementById(id); return el?el.value.trim():''; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let lastSeed = null;
let lockedSeed = null;
let isGenerating = false;
let abortController = null;
let cachedApiKey = '';

function getApiKey(){
  if(window.electronAPI && window.electronAPI.getApiKey) return cachedApiKey||'';
  return localStorage.getItem('agnes_api_key')||'';
}
async function saveApiKey(){
  const k=document.getElementById('apiKey').value.trim();
  if(!k){ showToast('请输入 API Key','error'); return; }
  if(window.electronAPI && window.electronAPI.saveApiKey){
    const ok=await window.electronAPI.saveApiKey(k);
    if(ok){ cachedApiKey=k; showToast('API Key 已安全保存','success'); }
    else { showToast('API Key 保存失败','error'); }
  }else{
    localStorage.setItem('agnes_api_key',k);
    showToast('API Key 已保存','success');
  }
}
function getAllModels(){ return [...PRESET_MODELS,...customModels]; }
function getNegPrompt(id){
  const el=document.getElementById(id);
  if(!el) return '';
  const wrap=el.closest('.negative-body');
  if(wrap&&!wrap.classList.contains('open')) return '';
  return el.value.trim();
}
function getSeedValue(){
  if(lockedSeed!==null) return lockedSeed;
  const s=val('seedInput');
  return s||null;
}
function showToast(msg,type){
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className='toast '+(type||'');
  t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(20px)'; setTimeout(()=>t.remove(),300); },3000);
}
function setGenerating(b){
  isGenerating=b;
  const btn=document.getElementById('submitTaskBtn');
  if(btn){ btn.disabled=b; btn.textContent=b?'生成中...':'提交任务'; }
}
function formatTime(t){
  if(!t) return '';
  try{ const d=new Date(t); if(!isNaN(d)) return d.toLocaleString('zh-CN'); }catch(e){}
  return t;
}

function extractMediaUrl(data, type){
  if(!data) return null;
  /* Deep search all string fields that look like URLs */
  function findUrls(obj, depth){
    if(depth>5||!obj) return [];
    let results=[];
    if(typeof obj==='string'){
      if(obj.startsWith('http') && (obj.includes('.mp4')||obj.includes('.mov')||obj.includes('.webm')||obj.includes('.png')||obj.includes('.jpg')||obj.includes('.jpeg')||obj.includes('.webp')||obj.includes('/videos/')||obj.includes('/images/')||obj.includes('cdn.')||obj.includes('oss.')||obj.includes('s3.')||obj.includes('blob.'))){
        return [obj];
      }
      return [];
    }
    if(Array.isArray(obj)){
      for(const item of obj) results=results.concat(findUrls(item,depth+1));
      return results;
    }
    if(typeof obj==='object'){
      /* Check known URL field names first */
      const urlFields=['url','video_url','image_url','file_url','download_url','content_url','media_url','src','source','video','image','output_url','result_url','signed_url'];
      for(const key of urlFields){
        if(obj[key]&&typeof obj[key]==='string') results=results.concat(findUrls(obj[key],depth+1));
      }
      /* Also check nested objects */
      for(const key of ['metadata','data','result','output','response','outputs','videos','images','files']){
        if(obj[key]) results=results.concat(findUrls(obj[key],depth+1));
      }
      return results;
    }
    return [];
  }
  const urls=findUrls(data,0);
  /* Filter by type preference */
  if(type==='video'){
    const videoUrl=urls.find(u=>u.includes('.mp4')||u.includes('.mov')||u.includes('.webm')||u.includes('/videos/'));
    if(videoUrl) return videoUrl;
  }
  if(type==='image'){
    const imgUrl=urls.find(u=>u.includes('.png')||u.includes('.jpg')||u.includes('.jpeg')||u.includes('.webp')||u.includes('/images/'));
    if(imgUrl) return imgUrl;
  }
  return urls[0]||null;
}

function isTaskCompleted(data){
  if(!data) return false;
  const s = (data.status||data.state||data.phase||data.stage||'').toLowerCase();
  const completedStates=['completed','succeeded','success','done','finished','ready','processed','complete','successed','publish','published'];
  if(completedStates.includes(s)) return true;
  /* Check for explicit completion flags */
  if(data.completed===true||data.done===true||data.finished===true||data.ready===true) return true;
  /* If there's a URL in the response AND progress is 100% or no pending state */
  const url=extractMediaUrl(data);
  if(url){
    const pendingStates=['pending','queued','processing','generating','running','in_progress','in-queue','waiting'];
    if(!pendingStates.includes(s)) return true;
  }
  return false;
}

function isTaskFailed(data){
  if(!data) return false;
  const s = (data.status||data.state||data.phase||'').toLowerCase();
  return s==='failed'||s==='error'||s==='failure'||s==='cancelled'||s==='canceled'||s==='timeout'||s==='expired';
}

function isElectron(){
  return typeof window.electronAPI!=='undefined' && window.electronAPI.isElectron();
}
