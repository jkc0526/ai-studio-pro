// ============ settings.js ============

let lastShownVersion = localStorage.getItem('last_shown_version')||'';

function isElectron(){
  return typeof window.electronAPI!=='undefined' && window.electronAPI.isElectron();
}

async function initUpdater(){
  const badge=document.getElementById('versionBadge');
  if(!isElectron()){
    if(badge){ badge.textContent='v'+APP_VERSION; }
  }else{
    try{
      const ver=await window.electronAPI.getAppVersion();
      if(badge) badge.textContent='v'+ver;
    }catch(e){
      if(badge) badge.textContent='v'+APP_VERSION;
    }
    try{
      window.electronAPI.onUpdateAvailable((info)=>{
        showUpdateBanner(info.version, info.releaseNotes);
      });
      window.electronAPI.onDownloadProgress((progress)=>{
        const right=document.getElementById('updateBannerRight');
        if(right){
          right.innerHTML='<div style="text-align:center"><div>下载中 '+progress.percent+'%</div><div class="update-progress-bar"><div class="update-progress-fill" style="width:'+progress.percent+'%"></div></div></div>';
        }
      });
      window.electronAPI.onUpdateDownloaded((info)=>{
        const right=document.getElementById('updateBannerRight');
        const text=document.getElementById('updateBannerText');
        if(text) text.textContent='更新已下载完成，立即安装？';
        if(right){
          right.innerHTML='<button class="btn" onclick="installUpdate()">立即安装并重启</button><button class="btn" onclick="closeUpdateBanner()">稍后</button>';
        }
      });
      window.electronAPI.onUpdateError((error)=>{
        showToast('更新出错: '+error.message,'error');
        closeUpdateBanner();
      });
    }catch(e){ console.warn('Updater events init failed:',e); }
  }
  /* 如果版本更新了，自动显示更新日志 */
  if(lastShownVersion !== APP_VERSION){
    showChangelog();
    localStorage.setItem('last_shown_version', APP_VERSION);
  }
}

function versionBadgeClick(e){
  checkForUpdates();
}

function showChangelog(){
  const body=document.getElementById('changelogBody');
  const title=document.getElementById('changelogTitle');
  if(!body) return;
  title.textContent='更新日志 v'+APP_VERSION;
  let html='';
  CHANGELOG.forEach(entry=>{
    html += `<div style="margin-bottom:16px">
      <div style="font-weight:600;color:var(--accent);font-size:14px;margin-bottom:6px">v${esc(entry.version)} <span style="color:var(--muted);font-weight:normal;font-size:12px;margin-left:8px">${esc(entry.date)}</span></div>
      <ul style="margin:0;padding-left:18px;color:var(--text)">
        ${entry.items.map(item=>`<li style="margin-bottom:4px">${esc(item)}</li>`).join('')}
      </ul>
    </div>`;
  });
  body.innerHTML=html;
  document.getElementById('changelogModal').classList.add('open');
}

function closeChangelog(){
  document.getElementById('changelogModal').classList.remove('open');
}

function toggleSection(sectionId){
  var sec=document.getElementById(sectionId);
  var arrowId=sectionId.replace('Section','Arrow');
  var arrow=document.getElementById(arrowId);
  if(!sec) return;
  var isHidden=sec.style.display==='none'||sec.style.display==='';
  sec.style.display=isHidden?'block':'none';
  if(arrow) arrow.style.transform=isHidden?'rotate(0deg)':'rotate(-90deg)';
}

function initSettingsView(){
  var verText=document.getElementById('settingsVersionText');
  if(verText) verText.textContent='v'+APP_VERSION;
  renderChangelogList();
  var savedKey=getApiKey();
  var apiKeyInput=document.getElementById('settingsApiKey');
  if(apiKeyInput) apiKeyInput.value=savedKey||'';
  var yanbaKey=localStorage.getItem('yanba_api_key')||'';
  var yanbaInput=document.getElementById('settingsYanbaKey');
  if(yanbaInput) yanbaInput.value=yanbaKey;
  /* 默认展开关于与更新 */
  var aboutSec=document.getElementById('aboutSection');
  var aboutArrow=document.getElementById('aboutArrow');
  if(aboutSec) aboutSec.style.display='block';
  if(aboutArrow) aboutArrow.style.transform='rotate(0deg)';
  /* 主题初始化 */
  initTheme();
}

function renderChangelogList(){
  var container=document.getElementById('changelogList');
  if(!container) return;
  var entries=CHANGELOG.slice(0,3);
  if(entries.length===0){ container.innerHTML='<p style="color:var(--muted);font-size:13px">暂无更新记录</p>'; return; }
  var html='';
  entries.forEach(function(entry, idx){
    html+='<div style="'+(idx>0?'margin-top:16px;padding-top:16px;border-top:1px solid var(--border)':'')+'">';
    html+='<div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:8px"><span style="display:inline-block;background:var(--accent);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;margin-right:8px;font-weight:500">v'+esc(entry.version)+'</span><span style="color:var(--muted);font-weight:normal;font-size:12px">'+esc(entry.date)+'</span></div>';
    html+='<ul style="margin:0;padding:0;list-style:none;color:var(--text);font-size:13px;line-height:1.9">';
    entry.items.forEach(function(item){
      html+='<li style="padding-left:14px;position:relative;margin-bottom:2px;color:var(--text-secondary)"><span style="position:absolute;left:0;color:var(--muted)">·</span>'+esc(item)+'</li>';
    });
    html+='</ul></div>';
  });
  container.innerHTML=html;
}

function saveSettingsApiKey(){
  var key=val('settingsApiKey');
  localStorage.setItem('agnes_api_key', key);
  cachedApiKey=key;
  if(window.electronAPI&&window.electronAPI.setApiKey) window.electronAPI.setApiKey(key);
  showToast('Agnes API Key 已保存','success');
}

function saveYanbaKey(){
  var key=val('settingsYanbaKey');
  localStorage.setItem('yanba_api_key', key);
  showToast('YanBa API Key 已保存','success');
}

function showUpdateBanner(version, notes){
  const banner=document.getElementById('updateBanner');
  const text=document.getElementById('updateBannerText');
  const right=document.getElementById('updateBannerRight');
  if(text) text.textContent='发现新版本 v'+version+(notes?'：'+notes:'');
  if(right){
    right.innerHTML='<button class="btn" onclick="downloadUpdate()">立即更新</button><button class="btn" onclick="closeUpdateBanner()">稍后</button>';
  }
  if(banner) banner.classList.add('open');
}

function closeUpdateBanner(){
  const banner=document.getElementById('updateBanner');
  if(banner) banner.classList.remove('open');
}

async function checkForUpdates(){
  if(!isElectron()){ showToast('Web版不支持自动更新，请刷新页面获取最新版本','warn'); return; }
  showToast('正在检查更新...','');
  try{
    const result=await window.electronAPI.checkForUpdates();
    if(result.success && result.hasUpdate){
      showUpdateBanner(result.version,'');
    } else if(result.success){
      showToast('已是最新版本','success');
    } else {
      showToast('检查更新失败: '+result.error,'error');
    }
  }catch(e){
    showToast('检查更新失败: '+e.message,'error');
  }
}

async function downloadUpdate(){
  if(!isElectron()) return;
  const right=document.getElementById('updateBannerRight');
  if(right){
    right.innerHTML='<div style="text-align:center"><div>下载中 0%</div><div class="update-progress-bar"><div class="update-progress-fill" style="width:0"></div></div></div>';
  }
  try{
    const result=await window.electronAPI.downloadUpdate();
    if(!result.success){
      showToast('下载更新失败: '+result.error,'error');
      closeUpdateBanner();
    }
  }catch(e){
    showToast('下载更新失败: '+e.message,'error');
    closeUpdateBanner();
  }
}

async function installUpdate(){
  if(!isElectron()) return;
  await window.electronAPI.installUpdate();
}

/* ==================== Theme Switch ==================== */
function initTheme(){
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('themeToggleBtn');
  if(btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if(btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}
