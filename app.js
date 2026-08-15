/* ════════════════════════════════════════════════════════════════
   ATELIER · Markdown Studio — app.js
   ════════════════════════════════════════════════════════════════ */
'use strict';

(() => {

/* ─────────────────────────  ELEMENTS  ───────────────────────── */
const $ = (s) => document.querySelector(s);
const editor      = $('#editor');
const preview     = $('#preview');
const lineNumbers = $('#lineNumbers');
const tocList     = $('#tocList');
const tocPane     = $('#tocPane');
const workspace   = $('#workspace');
const docTitle    = $('#docTitle');
const saveDot     = $('#saveDot');
const statWords   = $('#statWords');
const statChars   = $('#statChars');
const statReading = $('#statReading');
const statLines   = $('#statLines');
const statSel     = $('#statSel');
const statusMsg   = $('#statusMsg');
const toast       = $('#toast');
const fileInput   = $('#fileInput');

/* ─────────────────────────  STATE  ───────────────────────── */
const STORE_KEY = 'mdct:doc:v1';
const SETTINGS_KEY = 'mdct:settings:v1';
let saveTimer = null;
let renderTimer = null;
let syncLock = false;
let lastHeadings = [];

/* ─────────────────────────  SAMPLE CONTENT  ───────────────────────── */
const SAMPLE = `# Welcome to MDCT

A *quiet* place to write — **refined**, **focused**, **alive**. This is a fully-featured Markdown studio living in your browser.

> "Writing is thinking. To write well is to think clearly." — David McCullough

## What's inside

- Live preview with sync scrolling
- Three themes — light, sepia, dark
- Outline, focus mode, find & replace
- KaTeX math, syntax-highlighted code, task lists
- Autosave, export to \`md\` / \`html\` / \`pdf\`

## Typography & prose

MDCT pairs **Fraunces** — a characterful variable serif — with **Newsreader** for body text and **JetBrains Mono** for code. The result is an editorial page that feels printed, not rendered.

You can ==highlight key phrases==, strike ~~old ideas~~, or drop a footnote[^1].

[^1]: Footnotes are supported too.

## Lists & tasks

1. Open a document
2. Start writing
   - Let the words flow
   - Trust the silence
3. Export when ready

- [x] Build the editor
- [x] Add live preview
- [ ] Write something beautiful

## Code

\`\`\`javascript
// A tiny haiku in code
const words = ['silence', 'paper', 'ink'];
const poem = words
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' · ');
console.log(poem); // Silence · Paper · Ink
\`\`\`

Inline code reads as \`const stillness = true\` — quiet but precise.

## Math

Euler's identity, the most beautiful equation:

$$ e^{i\\pi} + 1 = 0 $$

And the Gaussian integral inline: $\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$.

## Tables

| Theme    | Mood         | Hour        |
|----------|--------------|-------------|
| Light    | Morning page | 07:00       |
| Sepia    | Afternoon tea| 15:00       |
| Dark     | Midnight oil | 23:00       |

## Shortcuts

| Action           | Shortcut            |
|------------------|---------------------|
| Bold             | \`⌘/Ctrl + B\`       |
| Italic           | \`⌘/Ctrl + I\`       |
| Link             | \`⌘/Ctrl + K\`       |
| Find             | \`⌘/Ctrl + F\`       |
| Focus mode       | \`⌘/Ctrl + .\`       |
| Toggle outline   | \`⌘/Ctrl + \\\`       |
| Switch view      | \`⌘/Ctrl + 1/2/3\`   |

---

Press **⌘ .** for focus mode. Drag the divider to resize. Drop an image straight onto the editor. *Begin.*
`;

/* ─────────────────────────  MARKED CONFIG  ───────────────────────── */
// Inline math: $...$  (not $$)
const inlineMathExt = {
  name: 'inlineMath',
  level: 'inline',
  start(src) { return src.indexOf('$'); },
  tokenizer(src) {
    const m = /^\$([^\$\n]+?)\$/.exec(src);
    if (m) return { type: 'inlineMath', raw: m[0], expr: m[1] };
  },
  renderer(token) {
    try {
      return katex.renderToString(token.expr, { throwOnError: false, displayMode: false });
    } catch (e) { return token.expr; }
  }
};
const blockMathExt = {
  name: 'blockMath',
  level: 'block',
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
    if (m) return { type: 'blockMath', raw: m[0], expr: m[1] };
  },
  renderer(token) {
    try {
      return '<p class="math-block">' + katex.renderToString(token.expr, { throwOnError: false, displayMode: true }) + '</p>';
    } catch (e) { return '<p>' + token.expr + '</p>'; }
  }
};

const markExt = {
  name: 'mark', level: 'inline',
  start(src) { return src.indexOf('=='); },
  tokenizer(src) {
    const m = /^==([^\s=][^=]*?)==/.exec(src);
    if (m && m[1].trim()) return { type: 'mark', raw: m[0], text: m[1] };
  },
  renderer(token) { return `<mark>${token.text}</mark>`; }
};

marked.use({
  gfm: true,
  breaks: false,
  extensions: [blockMathExt, inlineMathExt, markExt],
  renderer: {
    // Highlight code blocks
    code(code, lang) {
      const language = (lang || '').match(/^\w+/)?.[0] || '';
      let highlighted;
      try {
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(code, { language }).value;
        } else {
          highlighted = hljs.highlightAuto(code).value;
        }
      } catch (e) {
        highlighted = code.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      }
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    }
  }
});

/* ─────────────────────────  RENDER  ───────────────────────── */
function render() {
  const md = editor.value;
  let html;
  try {
    html = marked.parse(md);
  } catch (e) {
    html = '<p style="color:#c00">Parse error: ' + e.message + '</p>';
  }
  preview.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ['span'], ADD_ATTR: ['class'] });
  buildTOC();
  observeHeadings();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

/* ─────────────────────────  TOC  ───────────────────────── */
function buildTOC() {
  const headings = [...preview.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  if (!headings.length) {
    tocList.innerHTML = '<div class="toc-empty">No headings yet</div>';
    lastHeadings = [];
    return;
  }
  headings.forEach((h, i) => {
    if (!h.id) {
      const text = (h.textContent || '').trim().toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5-]/g, '').replace(/\s+/g, '-');
      h.id = text || ('h-' + i);
    }
  });
  lastHeadings = headings;
  tocList.innerHTML = headings.map(h => {
    const lv = parseInt(h.tagName[1], 10);
    return `<a class="lv-${lv}" href="#${h.id}" data-id="${h.id}">${escapeHTML(h.textContent || '')}</a>`;
  }).join('');
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

let tocObserver = null;
function observeHeadings() {
  if (tocObserver) tocObserver.disconnect();
  if (!lastHeadings.length) return;
  tocObserver = new IntersectionObserver((entries) => {
    // pick the topmost visible heading
    const visible = entries.filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    const id = visible[0].target.id;
    tocList.querySelectorAll('a').forEach(a => {
      a.classList.toggle('active', a.dataset.id === id);
    });
  }, { root: preview, rootMargin: '0px 0px -70% 0px', threshold: 0 });
  lastHeadings.forEach(h => tocObserver.observe(h));
}

tocList.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const el = preview.querySelector('#' + CSS.escape(a.dataset.id));
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ─────────────────────────  LINE NUMBERS  ───────────────────────── */
function updateLineNumbers() {
  const lines = editor.value.split('\n').length;
  // pad to current visible lines so scroll sync stays correct
  let html = '';
  for (let i = 1; i <= lines; i++) html += i + '\n';
  lineNumbers.innerHTML = html;
}

/* ─────────────────────────  STATS  ───────────────────────── */
function updateStats() {
  const text = editor.value;
  const chars = text.length;
  // word count: latin words + CJK chars
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_'’-]+/g) || []).length + cjk;
  const reading = Math.max(1, Math.round(words / 250));
  statWords.textContent = words + (words === 1 ? ' word' : ' words');
  statChars.textContent = chars + ' chars';
  statReading.textContent = reading + ' min read';

  // cursor position
  const pos = editor.selectionStart;
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  statLines.textContent = `Ln ${line}, Col ${col}`;
  const selLen = editor.selectionEnd - editor.selectionStart;
  statSel.textContent = selLen > 0 ? `${selLen} selected` : '0 selected';
}

/* ─────────────────────────  EDITOR INPUT  ───────────────────────── */
editor.addEventListener('input', () => {
  scheduleRender();
  updateLineNumbers();
  updateStats();
  scheduleSave();
  markDirty();
});

editor.addEventListener('keyup', updateStats);
editor.addEventListener('click', updateStats);
editor.addEventListener('select', updateStats);

/* ─────────────────────────  SYNC SCROLL  ───────────────────────── */
editor.addEventListener('scroll', () => {
  if (syncLock) return;
  syncLock = true;
  const ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
  preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight || 1);
  lineNumbers.scrollTop = editor.scrollTop;
  requestAnimationFrame(() => syncLock = false);
});
preview.addEventListener('scroll', () => {
  if (syncLock) return;
  if (document.body.dataset.view === 'preview') return;
  syncLock = true;
  const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
  editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight || 1);
  requestAnimationFrame(() => syncLock = false);
});

/* ─────────────────────────  TOOLBAR COMMANDS  ───────────────────────── */
function wrapSelection(pre, post = pre, placeholder = '') {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value.slice(start, end) || placeholder;
  const replacement = pre + text + post;
  editor.setRangeText(replacement, start, end, 'end');
  // select the inner text
  editor.selectionStart = start + pre.length;
  editor.selectionEnd = start + pre.length + text.length;
  editor.focus();
  afterEdit();
}

function insertText(text, cursorOffset = null) {
  const start = editor.selectionStart;
  editor.setRangeText(text, start, editor.selectionEnd, 'end');
  if (cursorOffset !== null) {
    editor.selectionStart = editor.selectionEnd = start + cursorOffset;
  }
  editor.focus();
  afterEdit();
}

function linePrefix(prefix, ordered = false) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  // extend selection to whole lines
  const selStart = lineStart;
  const lastLineEnd = text.indexOf('\n', end);
  const selEnd = lastLineEnd === -1 ? text.length : lastLineEnd;
  const block = text.slice(selStart, selEnd);
  const lines = block.split('\n');
  const newBlock = lines.map((ln, i) => {
    if (ordered) return `${i + 1}. ${ln}`;
    return prefix + ln;
  }).join('\n');
  editor.setRangeText(newBlock, selStart, selEnd, 'end');
  editor.selectionStart = selStart;
  editor.selectionEnd = selStart + newBlock.length;
  editor.focus();
  afterEdit();
}

function toggleLinePrefix(prefix) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selStart = text.lastIndexOf('\n', start - 1) + 1;
  const lastLineEnd = text.indexOf('\n', end);
  const selEnd = lastLineEnd === -1 ? text.length : lastLineEnd;
  const block = text.slice(selStart, selEnd);
  const lines = block.split('\n');
  const allHave = lines.every(l => l.startsWith(prefix));
  const newBlock = lines.map(l => allHave ? l.slice(prefix.length) : prefix + l).join('\n');
  editor.setRangeText(newBlock, selStart, selEnd, 'end');
  editor.focus();
  afterEdit();
}

const COMMANDS = {
  bold:     () => wrapSelection('**', '**', 'bold'),
  italic:   () => wrapSelection('*', '*', 'italic'),
  strike:   () => wrapSelection('~~', '~~', 'text'),
  mark:     () => wrapSelection('==', '==', 'highlight'),
  code:     () => wrapSelection('`', '`', 'code'),
  ul:       () => toggleLinePrefix('- '),
  ol:       () => linePrefix('', true),
  task:     () => toggleLinePrefix('- [ ] '),
  quote:    () => toggleLinePrefix('> '),
  link:     () => {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || 'link text';
    insertText(`[${sel}](https://)`, editor.selectionStart + sel.length + 3 + 9);
  },
  image:    () => {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || 'alt text';
    insertText(`![${sel}](https://)`, editor.selectionStart + sel.length + 4 + 9);
  },
  table:    () => insertText('\n| Column A | Column B | Column C |\n|----------|----------|----------|\n| Cell     | Cell     | Cell     |\n| Cell     | Cell     | Cell     |\n'),
  hr:       () => insertText('\n\n---\n\n'),
  codeblock:() => {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd) || 'code here';
    const pre = '```javascript\n', post = '\n```';
    const start = editor.selectionStart;
    editor.setRangeText(pre + sel + post, start, editor.selectionEnd, 'end');
    editor.focus();
    afterEdit();
  },
  math:     () => wrapSelection('$$', '$$', 'e^{i\\pi} + 1 = 0'),
  emoji:    () => toggleEmojiPicker(),
  undo:     () => document.execCommand('undo'),
  redo:     () => document.execCommand('redo'),
  find:     () => toggleFindbar(true),
  focus:    () => toggleFocus(),
};

document.querySelectorAll('.tool[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    if (COMMANDS[cmd]) COMMANDS[cmd]();
  });
});

/* heading select */
$('#headingSelect').addEventListener('change', (e) => {
  const lvl = e.target.value;
  const start = editor.selectionStart;
  const text = editor.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  // remove existing leading #'s
  const lineEnd = text.indexOf('\n', start);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const cleaned = line.replace(/^#{1,6}\s*/, '');
  let prefix = '';
  if (lvl !== 'p') prefix = '#'.repeat(parseInt(lvl[1], 10)) + ' ';
  const newLine = prefix + cleaned;
  editor.setRangeText(newLine, lineStart, lineEnd === -1 ? text.length : lineEnd, 'end');
  editor.focus();
  afterEdit();
  e.target.value = 'p';
});

function afterEdit() {
  scheduleRender();
  updateLineNumbers();
  updateStats();
  scheduleSave();
  markDirty();
}

/* ─────────────────────────  VIEW MODES  ───────────────────────── */
document.querySelectorAll('.view-modes button').forEach(b => {
  b.addEventListener('click', () => setViewMode(b.dataset.mode));
});
function setViewMode(mode) {
  document.body.dataset.view = mode;
  document.querySelectorAll('.view-modes button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  workspace.style.gridTemplateColumns = '';
  saveSettings();
}

/* ─────────────────────────  THEMES  ───────────────────────── */
document.querySelectorAll('.theme-switch button').forEach(b => {
  b.addEventListener('click', () => setTheme(b.dataset.theme));
});
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.theme-switch button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  saveSettings();
}

/* ─────────────────────────  TOC TOGGLE  ───────────────────────── */
$('#tocToggle').addEventListener('click', () => toggleTOC());
$('#tocClose').addEventListener('click', () => toggleTOC(false));
function toggleTOC(force) {
  const show = force !== undefined ? force : workspace.classList.contains('no-toc');
  workspace.classList.toggle('no-toc', !show);
  workspace.style.gridTemplateColumns = '';
  saveSettings();
}

/* ─────────────────────────  FOCUS MODE  ───────────────────────── */
function toggleFocus() {
  document.body.classList.toggle('focus');
  showToast(document.body.classList.contains('focus') ? 'Focus mode · hover edges for controls' : 'Focus mode off');
}

/* ─────────────────────────  RESIZER  ───────────────────────── */
const resizer = $('#resizer');
let resizing = false;
resizer.addEventListener('mousedown', (e) => {
  resizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const rect = workspace.getBoundingClientRect();
  const tocW = workspace.classList.contains('no-toc') ? 0 : 240;
  const available = rect.width - tocW - 6;
  let editorW = e.clientX - rect.left - tocW;
  editorW = Math.max(240, Math.min(available - 240, editorW));
  const previewW = available - editorW;
  workspace.style.gridTemplateColumns = `${tocW}px ${editorW}px 6px ${previewW}px`;
});
window.addEventListener('mouseup', () => {
  if (resizing) {
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

/* ─────────────────────────  KEYBOARD SHORTCUTS  ───────────────────────── */
editor.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    // Tab inserts two spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      insertText('  ');
      return;
    }
    // Enter: list continuation
    if (e.key === 'Enter' && !e.shiftKey) {
      handleListContinuation(e);
    }
    return;
  }

  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); COMMANDS.bold(); }
  else if (k === 'i') { e.preventDefault(); COMMANDS.italic(); }
  else if (k === 'k') { e.preventDefault(); COMMANDS.link(); }
  else if (k === 'f') { e.preventDefault(); toggleFindbar(true); }
  else if (k === '.') { e.preventDefault(); toggleFocus(); }
  else if (k === '\\') { e.preventDefault(); toggleTOC(); }
  else if (k === 's') { e.preventDefault(); saveLocal(true); showToast('Saved'); }
  else if (k === 'o') { e.preventDefault(); fileInput.click(); }
  else if (k === '1') { e.preventDefault(); setViewMode('editor'); }
  else if (k === '2') { e.preventDefault(); setViewMode('split'); }
  else if (k === '3') { e.preventDefault(); setViewMode('preview'); }
  else if (k === 'e') { e.preventDefault(); COMMANDS.emoji(); }
  else if (k === 'z' && e.shiftKey) { e.preventDefault(); COMMANDS.redo(); }
  else if (k === 'z') { e.preventDefault(); COMMANDS.undo(); }
});

function handleListContinuation(e) {
  const pos = editor.selectionStart;
  const text = editor.value;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const line = text.slice(lineStart, pos);
  // bullet / task / ordered
  let m = line.match(/^(\s*)([-*+])\s(\[[ x]\]\s)?(.*)$/);
  if (m) {
    e.preventDefault();
    const [full, indent, marker, task, content] = m;
    if (!content.trim()) {
      // empty item — exit list: remove the marker, stay on the blank line
      editor.setRangeText('', lineStart, pos, 'end');
      return;
    }
    let next = '\n' + indent + marker + ' ';
    if (task) next = '\n' + indent + marker + ' [ ] ';
    insertText(next);
    return;
  }
  // numbered list
  m = line.match(/^(\s*)(\d+)\.\s(.*)$/);
  if (m) {
    e.preventDefault();
    const [full, indent, num, content] = m;
    if (!content.trim()) {
      editor.setRangeText('', lineStart, pos, 'end');
      return;
    }
    insertText('\n' + indent + (parseInt(num, 10) + 1) + '. ');
  }
}

/* ─────────────────────────  DRAG & DROP IMAGE  ───────────────────────── */
editor.addEventListener('dragover', (e) => {
  e.preventDefault();
  editor.style.background = 'var(--accent-soft)';
});
editor.addEventListener('dragleave', () => { editor.style.background = ''; });
editor.addEventListener('drop', (e) => {
  e.preventDefault();
  editor.style.background = '';
  const files = [...e.dataTransfer.files];
  // .md / .markdown / .text files → load as document (only the first)
  const mdFile = files.find(f => /\.(md|markdown|mdown|mkd|text|txt)$/i.test(f.name) || f.type === 'text/markdown' || f.type === 'text/plain');
  if (mdFile) {
    loadFileIntoEditor(mdFile);
    return;
  }
  // images → embed inline
  const images = files.filter(f => f.type.startsWith('image/'));
  if (!images.length) return;
  images.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      insertText(`\n![${file.name}](${reader.result})\n`);
      showToast(`Inserted ${file.name}`);
    };
    reader.readAsDataURL(file);
  });
});

// also paste images
editor.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = () => {
        insertText(`\n![pasted image](${reader.result})\n`);
        showToast('Pasted image embedded');
      };
      reader.readAsDataURL(file);
      e.preventDefault();
      return;
    }
  }
});

/* ─────────────────────────  AUTOSAVE  ───────────────────────── */
function markDirty() {
  saveDot.classList.remove('saved');
  saveDot.classList.add('saving');
  statusMsg.textContent = 'Editing…';
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLocal(), 800);
}
function saveLocal(immediate = false) {
  clearTimeout(saveTimer);
  const payload = {
    title: docTitle.value,
    content: editor.value,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    saveDot.classList.remove('saving');
    saveDot.classList.add('saved');
    statusMsg.textContent = 'Saved · ' + new Date().toLocaleTimeString();
  } catch (e) {
    statusMsg.textContent = 'Save failed';
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    docTitle.value = payload.title || 'Untitled Document';
    editor.value = payload.content || '';
    return true;
  } catch (e) { return false; }
}

/* ─────────────────────────  SETTINGS  ───────────────────────── */
function saveSettings() {
  const s = {
    theme: document.documentElement.dataset.theme,
    view: document.body.dataset.view,
    toc: !workspace.classList.contains('no-toc'),
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.theme) setTheme(s.theme);
    if (s.view) setViewMode(s.view);
    if (s.toc === false) toggleTOC(false);
  } catch (e) {}
}

/* ─────────────────────────  EXPORT MENU  ───────────────────────── */
const exportBtn = $('#exportBtn');
const exportMenu = $('#exportMenu');
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportBtn.parentElement.classList.toggle('open');
});
document.addEventListener('click', () => exportBtn.parentElement.classList.remove('open'));

exportMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-export]');
  if (!btn) return;
  exportBtn.parentElement.classList.remove('open');
  const type = btn.dataset.export;
  if (type === 'md') downloadFile((docTitle.value || 'document') + '.md', editor.value, 'text/markdown');
  else if (type === 'html') downloadFile((docTitle.value || 'document') + '.html', buildStandaloneHTML(), 'text/html');
  else if (type === 'print') window.print();
  else if (type === 'copy') {
    navigator.clipboard.writeText(buildStandaloneHTML()).then(() => showToast('HTML copied to clipboard'));
  }
  else if (type === 'new') newDocument();
});

/* dedicated Open button */
$('#openBtn').addEventListener('click', () => fileInput.click());

function buildStandaloneHTML() {
  const css = [...document.styleSheets].map(ss => {
    try {
      return [...ss.cssRules].map(r => r.cssText).join('\n');
    } catch (e) { return ''; }
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHTML(docTitle.value)}</title>
<style>${css}</style>
</head>
<body data-view="preview">
<main class="workspace" style="grid-template-columns:0 0 0 1fr">
<section class="preview-pane" style="overflow:auto"><article class="prose">${preview.innerHTML}</article></section>
</main>
</body></html>`;
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Downloaded ' + name);
}

function newDocument() {
  if (!confirm('Start a new document? Current content will be cleared.')) return;
  editor.value = '';
  docTitle.value = 'Untitled Document';
  render(); updateLineNumbers(); updateStats(); syncTabTitle(); saveLocal();
  editor.focus();
}

function loadFileIntoEditor(file) {
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = reader.result;
    docTitle.value = file.name.replace(/\.(md|markdown|mdown|mkd|text|txt)$/i, '');
    render(); updateLineNumbers(); updateStats(); syncTabTitle(); saveLocal();
    showToast('Opened ' + file.name);
    editor.focus();
  };
  reader.onerror = () => showToast('Could not read ' + file.name);
  reader.readAsText(file);
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadFileIntoEditor(file);
  fileInput.value = '';
});

/* ─────────────────────────  FINDBAR  ───────────────────────── */
const findbar = $('#findbar');
const findInput = $('#findInput');
const replaceInput = $('#replaceInput');
const findCount = $('#findCount');
let findMatches = [];
let findIdx = -1;

function toggleFindbar(show) {
  findbar.hidden = !show;
  if (show) { findInput.focus(); findInput.select(); doFind(); }
}
function doFind() {
  const q = findInput.value;
  findMatches = [];
  findIdx = -1;
  if (q) {
    const text = editor.value;
    let i = 0;
    while ((i = text.indexOf(q, i)) !== -1) {
      findMatches.push([i, i + q.length]);
      i += q.length;
    }
  }
  if (findMatches.length) {
    findIdx = 0;
    highlightMatch();
  } else {
    editor.classList.remove('find-highlight');
  }
  findCount.textContent = findMatches.length ? `${findIdx + 1}/${findMatches.length}` : `0/0`;
}
function highlightMatch() {
  if (findIdx < 0 || !findMatches[findIdx]) return;
  const [s, e] = findMatches[findIdx];
  editor.focus();
  editor.setSelectionRange(s, e);
  // scroll into view
  const lineHeight = 26;
  const before = editor.value.slice(0, s);
  const line = before.split('\n').length;
  editor.scrollTop = (line - 1) * lineHeight;
}
findInput.addEventListener('input', doFind);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
  if (e.key === 'Escape') toggleFindbar(false);
});
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? replaceAll() : replaceOne(); }
  if (e.key === 'Escape') toggleFindbar(false);
});
function findNext() {
  if (!findMatches.length) return;
  findIdx = (findIdx + 1) % findMatches.length;
  highlightMatch();
  findCount.textContent = `${findIdx + 1}/${findMatches.length}`;
}
function findPrev() {
  if (!findMatches.length) return;
  findIdx = (findIdx - 1 + findMatches.length) % findMatches.length;
  highlightMatch();
  findCount.textContent = `${findIdx + 1}/${findMatches.length}`;
}
function replaceOne() {
  if (findIdx < 0) return;
  const [s, e] = findMatches[findIdx];
  const rep = replaceInput.value;
  editor.setRangeText(rep, s, e, 'end');
  afterEdit();
  doFind();
}
function replaceAll() {
  if (!findMatches.length) return;
  const q = findInput.value, rep = replaceInput.value;
  editor.value = editor.value.split(q).join(rep);
  afterEdit();
  doFind();
  showToast(`Replaced ${findMatches.length} occurrences`);
}
$('#findNext').addEventListener('click', findNext);
$('#findPrev').addEventListener('click', findPrev);
$('#replaceOne').addEventListener('click', replaceOne);
$('#replaceAll').addEventListener('click', replaceAll);
$('#findClose').addEventListener('click', () => toggleFindbar(false));

/* ─────────────────────────  EMOJI PICKER  ───────────────────────── */
const emojiPicker = $('#emojiPicker');
const emojiGrid = $('#emojiGrid');
const emojiSearch = $('#emojiSearch');
const EMOJIS = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😝 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ ⭐ 🌟 ⚡ 🔥 💧 🌊 ☀️ 🌙 ⭐ 🌟 ✨ ⚡ ☁️ ❄️ 🌈 🌸 🌺 🌻 🌼 🌷 🌹 🥀 🌿 🍃 🍀 🍁 🌍 🌎 🌏 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 ✅ ❌ ⚠️ ‼️ ⁉️ ❓ ❗ 〽️ ✏️ 📝 📖 📚 📌 📍 📎 🖊️ 🖌️ 🖍️ 📐 ✂️ 🔨 ⛏️ ⚙️ 🔗 🔒 🔑 🎯 🎨 🎭 🎵 🎶 ✅').split(/\s+/);

function toggleEmojiPicker() {
  if (emojiPicker.hidden) {
    const rect = $('[data-cmd="emoji"]').getBoundingClientRect();
    emojiPicker.style.top = (rect.bottom + 8) + 'px';
    emojiPicker.style.left = rect.left + 'px';
    emojiPicker.hidden = false;
    renderEmojis('');
    emojiSearch.focus();
  } else {
    emojiPicker.hidden = true;
  }
}
function renderEmojis(query) {
  // simple: just show all (no fuzzy search for emoji names)
  emojiGrid.innerHTML = EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('');
}
emojiSearch.addEventListener('input', () => renderEmojis(emojiSearch.value));
emojiGrid.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  insertText(b.dataset.e);
  emojiPicker.hidden = true;
  editor.focus();
});
document.addEventListener('click', (e) => {
  if (!emojiPicker.hidden && !emojiPicker.contains(e.target) && !e.target.closest('[data-cmd="emoji"]')) {
    emojiPicker.hidden = true;
  }
});

/* ─────────────────────────  TOAST  ───────────────────────── */
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.hidden = true, 300);
  }, 2200);
}

/* ─────────────────────────  DOC TITLE  ───────────────────────── */
const BASE_TITLE = 'MDCT — 在线 Markdown 编辑器';
function syncTabTitle() {
  const name = docTitle.value.trim();
  document.title = name ? `${name} · ${BASE_TITLE}` : BASE_TITLE;
}
docTitle.addEventListener('input', () => { scheduleSave(); syncTabTitle(); });

/* ─────────────────────────  INIT  ───────────────────────── */
function init() {
  loadSettings();
  if (!loadLocal()) {
    editor.value = SAMPLE;
    docTitle.value = 'Welcome to MDCT';
  }
  render();
  updateLineNumbers();
  updateStats();
  syncTabTitle();
  saveDot.classList.add('saved');
  statusMsg.textContent = 'Ready';
  editor.focus();
}

init();

})();
