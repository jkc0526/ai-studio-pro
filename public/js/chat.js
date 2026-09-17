// ============ chat.js ============

/* ==================== Chat Functionality ==================== */
let chatMessages = []; // [{role:'user'|'assistant', content:string}]
let chatGenerating = false;
let chatModel = null;

function getChatModel(){
  if(chatModel) return chatModel;
  chatModel = getAllModels().find(m=>m.type==='chat') || YANBA_MODELS[0];
  return chatModel;
}

function renderChatMessages(){
  const container = document.getElementById('chatMessages');
  const welcome = document.getElementById('chatWelcome');
  const suggestions = document.getElementById('chatSuggestions');
  if(!chatMessages.length){
    if(welcome) welcome.style.display = '';
    if(suggestions) suggestions.style.display = '';
    container.querySelectorAll('.chat-msg').forEach(el=>el.remove());
    return;
  }
  if(welcome) welcome.style.display = 'none';
  if(suggestions) suggestions.style.display = 'none';
  container.querySelectorAll('.chat-msg').forEach(el=>el.remove());
  chatMessages.forEach(msg=>{
    const div = document.createElement('div');
    div.className = 'chat-msg ' + msg.role;
    div.innerHTML = `<div class="chat-msg-avatar">${msg.role==='user'?'我':'AI'}</div><div class="chat-msg-body">${formatMarkdown(esc(msg.content))}</div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

function formatMarkdown(text){
  return text
    .replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
}

function appendChatChunk(text){
  if(chatMessages.length && chatMessages[chatMessages.length-1].role==='assistant'){
    chatMessages[chatMessages.length-1].content += text;
  } else {
    chatMessages.push({role:'assistant', content:text});
  }
  renderChatMessages();
}

async function sendChatMessage(){
  if(chatGenerating) return;
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  const text = input.value.trim();
  if(!text) return;
  chatMessages.push({role:'user', content:text});
  input.value = '';
  autoResizeChat(input);
  renderChatMessages();
  chatGenerating = true;
  sendBtn.disabled = true;
  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-msg assistant';
  typingDiv.id = 'chatTyping';
  typingDiv.innerHTML = '<div class="chat-msg-avatar">AI</div><div class="chat-msg-body"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
  document.getElementById('chatMessages').appendChild(typingDiv);
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
  try{
    const model = getChatModel();
    const apiKey = model.apiKey || getApiKey();
    const base = model.apiBase || '';
    const messages = chatMessages.map(m=>({role:m.role==='assistant'?'assistant':'user', content:m.content}));
    const resp = await fetch('/api/chat/completions',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + apiKey,
        'x-api-base': base
      },
      body:JSON.stringify({
        model: model.modelId,
        messages: messages,
        stream: true
      })
    });
    typingDiv.remove();
    if(!resp.ok){
      const errText = await resp.text();
      appendChatChunk('请求失败: ' + errText);
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, {stream:true});
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for(const line of lines){
        const trimmed = line.trim();
        if(!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if(data === '[DONE]') continue;
        try{
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if(delta && delta.content){
            appendChatChunk(delta.content);
          }
        }catch(e){}
      }
    }
  }catch(err){
    const typing = document.getElementById('chatTyping');
    if(typing) typing.remove();
    appendChatChunk('网络错误: ' + err.message);
  }finally{
    chatGenerating = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function sendQuickMsg(text){
  document.getElementById('chatInput').value = text;
  sendChatMessage();
}

function chatKeydown(e){
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    sendChatMessage();
  }
}

function autoResizeChat(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function clearChatHistory(){
  if(chatMessages.length && !confirm('确定要清空对话记录吗？')) return;
  chatMessages = [];
  renderChatMessages();
  showToast('对话已清空','success');
}

function renderChatModelSelect(){
  const sel = document.getElementById('chatModelSelect');
  if(!sel) return;
  const chatModels = getAllModels().filter(m=>m.type==='chat');
  sel.innerHTML = chatModels.map(m=>`<option value="${m.id}">${esc(m.icon)} ${esc(m.name)}</option>`).join('');
  const cur = getChatModel();
  if(cur) sel.value = cur.id;
}

function switchChatModel(id){
  chatModel = getAllModels().find(m=>m.id===id) || YANBA_MODELS[0];
  showToast('已切换到: ' + chatModel.name, 'success');
}
