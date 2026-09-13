import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ============================================================================
   MentionInput —— 支持 @素材 内联缩略图的富文本输入
   - @图片1 / @视频1 会渲染成文字流中的缩略图 chip（对齐 LibTV）
   - 保留光标位置：外部值变化会重建 DOM，重建后按字符偏移恢复光标
   - 中文输入法安全：composition 期间不重建 DOM
   - 输入的纯文本仍是 @图片1 的形式，落库 / 送后端不变
   ============================================================================ */

const MENTION_RE = /@\s*(?:图片|视频)\s*\d+/g;
const normKey = (s) => s.replace(/@\s*/, '').replace(/\s+/g, '');

/** contenteditable 子树 → 纯文本（chip 还原成 @图片N） */
function serialize(el) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1) {
      if (n.dataset?.mention) out += `@${n.dataset.mention}`;
      else if (n.tagName === 'BR') out += '\n';
      else out += n.textContent;
    }
  }
  return out;
}

/** 当前光标 → 字符偏移 */
function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const holder = document.createElement('div');
  holder.appendChild(pre.cloneContents());
  return serialize(holder).length;
}

/** 字符偏移 → 恢复光标 */
function setCaret(el, offset) {
  let remaining = offset;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let node = walker.nextNode();
  let placed = false;
  while (node) {
    const len = node.nodeType === 3 ? node.textContent.length
      : (node.nodeType === 1 && node.dataset?.mention) ? node.dataset.mention.length + 1
        : 0;
    if (len && remaining <= len) {
      const range = document.createRange();
      if (node.nodeType === 3) range.setStart(node, Math.max(0, Math.min(remaining, len)));
      else range.setStartBefore(node);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      placed = true;
      break;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  if (!placed) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

const MentionInput = forwardRef(function MentionInput({
  value = '', onChange, refs = [], placeholder = '', onPreview, onSubmit, rows = 3,
}, ref) {
  const boxRef = useRef(null);
  const composing = useRef(false);
  const lastCaret = useRef(null);                  // blur 前记住光标偏移，外部「参考」缩略图插入时能回到原位
  const [picker, setPicker] = useState(null);      // { query }
  const refByKey = new Map(refs.map((r) => [r.key, r]));

  /* 渲染：把纯文本按 @素材 切分，mention 段渲染成 chip */
  const render = useCallback((text, keepCaret) => {
    const el = boxRef.current;
    if (!el) return;
    const offset = keepCaret ? caretOffset(el) : null;
    el.textContent = '';
    const re = new RegExp(MENTION_RE.source, 'g');
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const key = normKey(m[0]);
      const ref = refByKey.get(key);
      const chip = document.createElement('span');
      chip.className = 'mi-chip';
      chip.dataset.mention = key;
      chip.contentEditable = 'false';
      if (ref) {
        const img = document.createElement('img');
        img.src = ref.url;
        img.alt = key;
        chip.appendChild(img);
        chip.title = `${key}${ref.label ? ` · ${ref.label}` : ''}（点击放大）`;
      } else {
        chip.classList.add('missing');
        chip.textContent = key;
        chip.title = '该素材已不在连线上';
      }
      el.appendChild(chip);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    if (keepCaret && offset != null) setCaret(el, offset);
  }, [onPreview, refs]);   // refs 变化要重渲染（缩略图源变了）

  /* 外部值变化 → 重建 DOM（输入法组字期间跳过，避免打断候选） */
  useEffect(() => {
    if (composing.current) return;
    const el = boxRef.current;
    if (!el) return;
    if (serialize(el) === value) return;
    render(value, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, refs]);

  const emit = (text, keepCaret = true) => {
    onChange?.(text);
    render(text, keepCaret);
  };

  const insertText = (t) => {
    const el = boxRef.current;
    const cur = serialize(el);
    const off = caretOffset(el) ?? cur.length;
    const before = cur.slice(0, off).replace(/@[^\s@]*$/, '');
    const after = cur.slice(off);
    const next = before + t + after;
    emit(next);
    // 光标放到插入内容之后
    requestAnimationFrame(() => setCaret(boxRef.current, before.length + t.length));
  };

  const onInput = () => {
    const el = boxRef.current;
    const text = serialize(el);
    onChange?.(text);
    // @ 选择器：光标前的半截 @query
    const off = caretOffset(el) ?? text.length;
    lastCaret.current = off;
    const m = text.slice(0, off).match(/@\s*([^\s@]*)$/);
    if (m && refs.length) {
      // 已经写成完整 mention 的就不再弹
      const tail = m[0];
      setPicker(MENTION_RE.test(tail) && /\d$/.test(tail) ? null : { query: m[1] || '' });
    } else setPicker(null);
  };

  const onKeyDown = (e) => {
    if (picker) {
      if (e.key === 'Escape') { e.preventDefault(); setPicker(null); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const list = refs.filter((r) => !picker.query || r.key.includes(picker.query) || (r.label || '').includes(picker.query));
        if (list[0]) { setPicker(null); insertText(`@${list[0].key} `); }
        return;
      }
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const el = boxRef.current;
      const cur = serialize(el);
      const off = caretOffset(el) ?? cur.length;
      emit(`${cur.slice(0, off)}\n${cur.slice(off)}`);
      requestAnimationFrame(() => setCaret(boxRef.current, off + 1));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSubmit?.(); }
  };

  const shown = picker
    ? refs.filter((r) => !picker.query || r.key.includes(picker.query) || (r.label || '').includes(picker.query))
    : [];

  /* 命令式接口：外部（如「参考」缩略图）直接插入某个素材的引用。
     先 focus 再恢复上次光标位置，否则 blur 后 caret 会回到开头/末尾，插入位置就乱了。 */
  useImperativeHandle(ref, () => ({
    insert: (key) => {
      const el = boxRef.current;
      if (!el) return;
      el.focus();
      const text = serialize(el);
      const off = lastCaret.current ?? text.length;
      setCaret(el, off);
      insertText(`@${key} `);
    },
    focus: () => boxRef.current?.focus(),
  }), [refs, value]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mi-wrap" style={{ minHeight: `${rows * 22 + 16}px` }}>
      <div
        ref={boxRef}
        className="mi-box nodrag"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          // 点内联缩略图 → 放大预览（用容器级委托，避免 contenteditable 子节点原生监听丢失）
          const chip = e.target.closest?.('[data-mention]');
          if (!chip) return;
          e.preventDefault();
          const ref = refByKey.get(chip.dataset.mention);
          if (ref) onPreview?.(ref);
        }}
        onBlur={() => {
          const el = boxRef.current;
          if (el) lastCaret.current = caretOffset(el) ?? serialize(el).length;
          setTimeout(() => setPicker(null), 150);
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => {
          composing.current = false;
          const el = boxRef.current;
          const text = serialize(el);
          onChange?.(text);
          render(text, true);
        }}
        onPaste={(e) => {
          // 粘贴时只取纯文本，避免带入外部样式
          e.preventDefault();
          const t = e.clipboardData?.getData('text/plain') || '';
          if (t) insertText(t);
        }}
      />
      {picker && (
        <div className="mi-picker">
          {!shown.length && <div className="mi-picker-empty">没有匹配的素材</div>}
          {shown.map((r, i) => (
            <button key={r.key} type="button" className={`mi-picker-item ${i === 0 ? 'first' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setPicker(null); insertText(`@${r.key} `); }}>
              <span className="mi-picker-thumb">
                {r.type === 'image' ? <img src={r.url} alt="" /> : <video src={r.url} muted />}
              </span>
              <span className="mi-picker-label">{r.key}</span>
              {r.label && <span className="mi-picker-sub">{r.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MentionInput;
