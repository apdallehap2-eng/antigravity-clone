'use strict';
/* ============ أدوات عامة ============ */
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============ وضع المتصفح (للتجربة بدون Electron) ============ */
function browserShim() {
  const vfs = { '/demo/index.html': '<h1>مرحبًا</h1>\n<script src="app.js"></script>\n', '/demo/app.js': 'console.log("hi");\n' };
  const ls = JSON.parse(localStorage.getItem('ag_db') || '{}'), sv = () => localStorage.setItem('ag_db', JSON.stringify(ls));
  return {
    electron: false,
    db: {
      get: async (c, k) => (ls[c] || {})[k] ?? null, set: async (c, k, v) => { (ls[c] = ls[c] || {})[k] = v; sv(); return true; },
      list: async c => Object.keys(ls[c] || {}), del: async (c, k) => { delete (ls[c] || {})[k]; sv(); return true; },
      info: async () => ({ name: 'localStorage (وضع المتصفح)', note: '' })
    },
    fs: {
      list: async d => {
        const p = d.replace(/\/$/, '') + '/', m = {};
        Object.keys(vfs).filter(k => k.startsWith(p)).forEach(k => { const r = k.slice(p.length), i = r.indexOf('/'); m[i < 0 ? r : r.slice(0, i)] = i >= 0; });
        return Object.entries(m).map(([name, dir]) => ({ name, dir })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
      },
      read: async f => { if (!(f in vfs)) throw new Error('ENOENT: ' + f); return vfs[f]; },
      write: async (f, t) => { vfs[f] = t; return true; },
      exists: async f => f in vfs || Object.keys(vfs).some(k => k.startsWith(f + '/'))
    },
    pickFolder: async () => null, defaultWs: async () => '/demo',
    exec: async () => ({ code: -1, out: 'تنفيذ الأوامر غير متاح في وضع المتصفح — شغّل التطبيق عبر Electron.' }),
    http: async (u, o) => { try { const r = await fetch(u, { method: o.method || 'POST', headers: o.headers, body: o.body }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } },
    onExec: () => {}
  };
}
const api = window.api || browserShim();

/* ============ الحالة ============ */
const S = { ws: '', tabs: [], cur: null, cfg: { provider: 'gemini', key: '', model: '', base: '', rules: '', mode: 'strict' },
  chat: [], arts: { plan: [], logs: [], shots: [], changes: [] }, errs: [], busy: false, stop: false };
const LANG = { js: 'javascript', ts: 'typescript', json: 'json', html: 'html', css: 'css', md: 'markdown', py: 'python' };
const lang = p => LANG[(p.split('.').pop() || '').toLowerCase()] || 'plaintext';
const norm = p => { const o = []; p.replace(/\\/g, '/').split('/').forEach(x => { if (x === '..') o.pop(); else if (x && x !== '.') o.push(x); }); return o.join('/').toLowerCase(); };
const abs = p => /^([A-Za-z]:|[\\/])/.test(p) ? p : S.ws.replace(/[\\/]$/, '') + '/' + p;
const outside = f => !norm(f).startsWith(norm(S.ws));
const base = p => p.replace(/\\/g, '/').split('/').pop();

let saveT;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { if (S.ws) api.db.set('chats', S.ws, { chat: S.chat.slice(-200), arts: { ...S.arts, shots: S.arts.shots.slice(-5) } }); }, 400);
}

/* ============ المحرر (Monaco إن وُجد، وإلا محرر بديل) ============ */
let ED;
function loadMonaco() {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = '../node_modules/monaco-editor/min/vs/loader.js';
    s.onerror = () => no(new Error('no monaco'));
    s.onload = () => { require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } }); require(['vs/editor/editor.main'], () => ok(), no); };
    document.head.appendChild(s);
  });
}
async function initEditor() {
  const host = $('#editor'); let guard = false;
  try {
    await Promise.race([loadMonaco(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]);
    const m = monaco.editor.create(host, { theme: 'vs-dark', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, value: '' });
    m.onDidChangeModelContent(() => { if (!guard) onEdit(); });
    ED = { name: 'Monaco', get: () => m.getValue(), set: (t, l) => { guard = true; m.setValue(t); monaco.editor.setModelLanguage(m.getModel(), l); guard = false; } };
  } catch (e) {
    const g = el('pre', 'gut'), ta = el('textarea'); ta.spellcheck = false; host.append(g, ta);
    const u = () => { g.textContent = ta.value.split('\n').map((_, i) => i + 1).join('\n'); };
    ta.oninput = () => { u(); onEdit(); }; ta.onscroll = () => { g.scrollTop = ta.scrollTop; };
    ta.onkeydown = e => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); } };
    ED = { name: 'محرر بسيط', get: () => ta.value, set: t => { ta.value = t; u(); } };
  }
}
function onEdit() { const t = S.tabs.find(x => x.path === S.cur); if (t) { t.content = ED.get(); t.dirty = true; renderTabs(); } }
function renderTabs() {
  const box = $('#tabs'); box.innerHTML = '';
  S.tabs.forEach(t => {
    const d = el('div', 'tab' + (t.path === S.cur ? ' on' : ''), `${esc(base(t.path))}${t.dirty ? '<i>●</i>' : ''}<b>✕</b>`);
    d.onclick = () => activate(t.path);
    d.querySelector('b').onclick = e => { e.stopPropagation(); closeTab(t.path); };
    box.append(d);
  });
}
function activate(p) {
  const cur = S.tabs.find(x => x.path === S.cur); if (cur) cur.content = ED.get();
  S.cur = p; const t = S.tabs.find(x => x.path === p);
  ED.set(t ? t.content : '', lang(p)); renderTabs();
  document.querySelectorAll('.ti').forEach(r => r.classList.toggle('sel', r.dataset.p === p));
}
function closeTab(p) { S.tabs = S.tabs.filter(x => x.path !== p); if (S.cur === p) { S.cur = null; activate(S.tabs.length ? S.tabs[S.tabs.length - 1].path : null); } else renderTabs(); }
async function openFile(p) {
  if (!S.tabs.find(x => x.path === p)) { try { S.tabs.push({ path: p, content: await api.fs.read(p), dirty: false }); } catch (e) { return addErr('تعذّر فتح ' + p + ': ' + e.message); } }
  activate(p);
}
async function saveFile() {
  const t = S.tabs.find(x => x.path === S.cur); if (!t) return;
  t.content = ED.get(); await api.fs.write(t.path, t.content); t.dirty = false; renderTabs();
}

/* ============ المستكشف والمشاريع ============ */
async function tree(dir, box, d = 0) {
  box.innerHTML = ''; let items;
  try { items = await api.fs.list(dir); } catch (e) { box.textContent = 'تعذّر قراءة المجلد'; return; }
  if (!items.length && d === 0) box.append(el('div', 'ti', '<i style="color:#6e7681">(المجلد فارغ)</i>'));
  for (const it of items) {
    const full = dir.replace(/[\\/]$/, '') + '/' + it.name;
    const row = el('div', 'ti', (it.dir ? '▸ ' : '· ') + esc(it.name)); row.style.paddingLeft = (10 + d * 14) + 'px'; row.dataset.p = full; box.append(row);
    if (it.dir) {
      const sub = el('div'); sub.hidden = true; box.append(sub); let loaded = false;
      row.onclick = async () => { sub.hidden = !sub.hidden; row.firstChild.textContent = (sub.hidden ? '▸ ' : '▾ ') + it.name; if (!loaded) { loaded = true; await tree(full, sub, d + 1); } };
    } else row.onclick = () => openFile(full);
  }
}
const refreshTree = () => tree(S.ws, $('#tree'));
async function renderProjects() {
  const box = $('#projects'); box.innerHTML = '';
  for (const p of await api.db.list('projects')) { const r = el('div', 'ti', '◆ ' + esc(base(p))); r.title = p; r.onclick = () => openWs(p); box.append(r); }
}
async function openWs(ws) {
  S.ws = ws; S.tabs = []; S.cur = null; ED.set('', 'plaintext'); renderTabs();
  $('#wsname').textContent = ws;
  await api.db.set('settings', 'lastWs', ws); await api.db.set('projects', ws, { t: Date.now() });
  const saved = await api.db.get('chats', ws);
  S.chat = saved ? saved.chat : []; S.arts = saved ? { plan: [], logs: [], shots: [], changes: [], ...saved.arts } : { plan: [], logs: [], shots: [], changes: [] };
  $('#msgs').innerHTML = ''; S.chat.forEach(m => bubble(m.r, m.t)); renderArts(); refreshTree(); renderProjects();
}

/* ============ الطرفية ============ */
function termInit() {
  const t = $('#term'); t.innerHTML = '<pre id="tout"></pre><div class="tin"><span>$</span><input id="tcmd" placeholder="اكتب أمرًا ثم Enter"></div>';
  api.onExec(s => { $('#tout').textContent += s; t.scrollTop = 1e9; });
  $('#tcmd').onkeydown = async e => {
    if (e.key !== 'Enter') return; const c = e.target.value; e.target.value = '';
    $('#tout').textContent += '\n$ ' + c + '\n'; const r = await api.exec(c, S.ws);
    if (!api.electron) $('#tout').textContent += r.out + '\n'; t.scrollTop = 1e9;
  };
}
function showPane(p) { document.querySelectorAll('.btabs button').forEach(b => b.classList.toggle('on', b.dataset.p === p)); $('#term').hidden = p !== 'term'; $('#prev').hidden = p !== 'prev'; }

/* ============ المعاينة (متصفح الاختبار المدمج) ============ */
function mkPreview() {
  const w = el(api.electron ? 'webview' : 'iframe'); w.id = 'pvv'; w.style.cssText = 'width:100%;height:100%;border:0;background:#fff'; $('#pv').append(w);
  if (api.electron) w.addEventListener('console-message', e => { if (e.level >= 2) addErr('Preview: ' + e.message + ' (' + String(e.sourceId || '').split('/').pop() + ':' + e.line + ')'); });
}
const toUrl = u => /^(https?|file):/.test(u) ? u : 'file:///' + abs(u).replace(/\\/g, '/').replace(/^\//, '');
function navTo(url) {
  showPane('prev'); const w = $('#pvv'); $('#purl').value = url;
  return new Promise(ok => { const t = setTimeout(ok, 8000); w.addEventListener(api.electron ? 'did-finish-load' : 'load', () => { clearTimeout(t); ok(); }, { once: true }); w.src = toUrl(url); });
}
async function pageEval(js) { const w = $('#pvv'); return api.electron ? await w.executeJavaScript(js) : w.contentWindow.eval(js); }

/* ============ الأخطاء ============ */
function addErr(m) { S.errs.push(m); $('#ecount').textContent = '(' + S.errs.length + ')'; $('#errs').innerHTML = S.errs.slice(-100).map(e => `<div class="m err">${esc(e)}</div>`).join(''); }

/* ============ الدردشة ============ */
function bubble(r, t) { const d = el('div', 'm ' + r); d.dir = 'auto'; d.textContent = t; $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d; }
function say(r, t) { S.chat.push({ r, t }); bubble(r, t); persist(); }

/* ============ المراجعة اللحظية (Inline Diff) ============ */
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  if (n * m > 4e6) return [...A.map(t => ['-', t]), ...B.map(t => ['+', t])];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const o = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { o.push([' ', A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) o.push(['-', A[i++]]); else o.push(['+', B[j++]]); }
  while (i < n) o.push(['-', A[i++]]); while (j < m) o.push(['+', B[j++]]);
  return o;
}
let reviewResolve = null;
function review(path, oldT, newT) {
  return new Promise(ok => {
    const d = diffLines(oldT, newT), keep = d.map(() => false);
    d.forEach((x, i) => { if (x[0] !== ' ') for (let k = Math.max(0, i - 3); k <= Math.min(d.length - 1, i + 3); k++) keep[k] = true; });
    let html = '', gap = false;
    d.forEach((x, i) => { if (!keep[i]) { gap = true; return; } if (gap) { html += '<div class="dl g">⋯</div>'; gap = false; } html += `<div class="dl ${x[0] === '+' ? 'a' : x[0] === '-' ? 'd' : ''}">${x[0] === ' ' ? '  ' : x[0] + ' '}${esc(x[1])}</div>`; });
    const r = $('#review'); r.hidden = false;
    r.innerHTML = `<div class="rh"><span>مراجعة تعديل:</span><b>${esc(path)}</b><button id="rj">رفض (Esc)</button><button id="ra" class="ok">قبول (Alt+Enter)</button></div><div class="rd">${html}</div>`;
    const fin = v => { r.hidden = true; reviewResolve = null; ok(v); };
    reviewResolve = fin; $('#ra').onclick = () => fin(true); $('#rj').onclick = () => fin(false);
  });
}
async function proposeChange(path, newT) {
  const f = abs(path); let oldT = ''; try { oldT = await api.fs.read(f); } catch (e) {}
  if (oldT === newT) return 'لا تغيير: المحتوى مطابق.';
  if (S.cfg.mode === 'strict' && outside(f) && !(await ask('طلب كتابة خارج مساحة العمل', f))) { S.arts.changes.push({ path: f, st: 'مرفوض (خارج المساحة)' }); renderArts(); return 'USER DENIED: writing outside workspace.'; }
  const ok = S.cfg.mode === 'turbo' ? true : await review(f, oldT, newT);
  S.arts.changes.push({ path: f, st: ok ? 'مُطبّق' : 'مرفوض' }); renderArts();
  if (!ok) return 'USER REJECTED this change. Ask what they want or try another approach.';
  await api.fs.write(f, newT); refreshTree();
  const t = S.tabs.find(x => x.path === f); if (t) { t.content = newT; t.dirty = false; if (S.cur === f) ED.set(newT, lang(f)); }
  return 'تم حفظ الملف ' + path;
}

/* ============ النوافذ ============ */
function ask(title, body) {
  return new Promise(ok => {
    const m = $('#modal'); m.innerHTML = `<div class="box"><h3 class="warn">⚠ ${esc(title)}</h3><pre>${esc(body)}</pre><div class="row"><button id="my" class="ok">موافقة</button><button id="mn">رفض</button></div></div>`; m.hidden = false;
    $('#my').onclick = () => { m.hidden = true; ok(true); }; $('#mn').onclick = () => { m.hidden = true; ok(false); };
  });
}
function settings() {
  const c = S.cfg, m = $('#modal');
  m.innerHTML = `<div class="box"><h3>الإعدادات</h3>
  <label>المزوّد</label><select id="sp"><option value="gemini">Gemini (واجهة متوافقة مع OpenAI)</option><option value="claude">Claude (Anthropic)</option><option value="custom">مخصّص (متوافق مع OpenAI: OpenRouter / Ollama…)</option></select>
  <label>مفتاح API (يُحفظ محليًا في قاعدة البيانات)</label><input id="sk" type="password" value="${esc(c.key)}">
  <label>اسم النموذج (اتركه فارغًا للافتراضي)</label><input id="sm" value="${esc(c.model)}" placeholder="gemini-2.5-pro / claude-sonnet-5-5">
  <label>عنوان API الأساسي (اختياري)</label><input id="sb" value="${esc(c.base)}" placeholder="https://…">
  <label>القواعد العامة (Global Rules ≈ GEMINI.md)</label><textarea id="sr" rows="4">${esc(c.rules)}</textarea>
  <div class="row"><button id="ss" class="ok">حفظ</button><button id="sc">إلغاء</button></div></div>`;
  m.hidden = false; $('#sp').value = c.provider;
  $('#sc').onclick = () => { m.hidden = true; };
  $('#ss').onclick = async () => { Object.assign(S.cfg, { provider: $('#sp').value, key: $('#sk').value.trim(), model: $('#sm').value.trim(), base: $('#sb').value.trim(), rules: $('#sr').value }); await saveCfg(); m.hidden = true; };
}
async function saveCfg() { await api.db.set('settings', 'cfg', S.cfg); statusBar(); }
function statusBar() { $('#mode').textContent = S.cfg.mode === 'turbo' ? '⚡ Turbo (بدون استئذان)' : '🛡 Strict (مراجعة وموافقة)'; $('#stmodel').textContent = S.cfg.provider + (S.cfg.model ? ' / ' + S.cfg.model : ''); }

/* ============ الأدلة (Artifacts) ============ */
function renderArts() {
  const b = $('#arts'); b.innerHTML = ''; const A = S.arts;
  const plan = el('div', 'art', '<h4>📋 plan.md — خطة التنفيذ</h4>');
  if (!A.plan.length) plan.append(el('div', '', '<i style="color:#6e7681">لا توجد خطة بعد — سيولّدها الوكيل أولًا.</i>'));
  A.plan.forEach((it, i) => {
    const r = el('div', 'pl' + (it.done ? ' dn' : ''), `<input type="checkbox" ${it.done ? 'checked' : ''}><span dir="auto">${esc(it.text)}</span><b class="x">✕</b>`);
    r.querySelector('input').onchange = e => { it.done = e.target.checked; renderArts(); persist(); };
    r.querySelector('span').ondblclick = () => { const t = prompt('تعديل البند:', it.text); if (t) { it.text = t; renderArts(); persist(); } };
    r.querySelector('.x').onclick = () => { A.plan.splice(i, 1); renderArts(); persist(); }; plan.append(r);
  });
  b.append(plan);
  b.append(el('div', 'art', '<h4>✎ التعديلات</h4>' + (A.changes.slice(-15).map(c => `<div dir="ltr" style="font-size:11.5px">${esc(base(c.path))} — ${esc(c.st)}</div>`).join('') || '<i style="color:#6e7681">—</i>')));
  b.append(el('div', 'art', '<h4>⌨ سجل الأوامر</h4>' + (A.logs.slice(-8).map(l => `<pre>$ ${esc(l.cmd)}\n[exit ${l.code}] ${esc(l.out.slice(-600))}</pre>`).join('') || '<i style="color:#6e7681">—</i>')));
  b.append(el('div', 'art', '<h4>📸 لقطات المتصفح</h4>' + (A.shots.slice(-3).map(s => `<img src="${s.url}">`).join('') || '<i style="color:#6e7681">—</i>')));
}

/* ============ أدوات الوكيل ============ */
const T = (name, description, properties, required) => ({ name, description, parameters: { type: 'object', properties, required } });
const str = { type: 'string' };
const TOOLS = [
  T('update_plan', 'Create/update the execution plan as a checklist. Call FIRST before any edit, then update it as items are finished.', { items: { type: 'array', items: { type: 'object', properties: { text: str, done: { type: 'boolean' } }, required: ['text', 'done'] } } }, ['items']),
  T('list_dir', 'List files in a directory (relative to workspace).', { path: str }, ['path']),
  T('read_file', 'Read a text file.', { path: str }, ['path']),
  T('write_file', 'Create or overwrite a file with full content. The user reviews the diff and may reject.', { path: str, content: str }, ['path', 'content']),
  T('run_command', 'Run a shell command in the workspace (e.g. npm test).', { command: str }, ['command']),
  T('browser_open', 'Open a URL or local HTML file path in the built-in preview browser.', { url: str }, ['url']),
  T('browser_read', 'Read the preview page: title, visible text, controls, and recent console errors.', {}, []),
  T('browser_eval', 'Run JavaScript in the preview page (e.g. click a button) and return the result.', { script: str }, ['script']),
  T('browser_screenshot', 'Capture a screenshot of the preview page into the Artifacts panel.', {}, []),
  T('spawn_subagent', 'Delegate a focused task (research, coding, testing) to an isolated subagent with its own fresh context. Returns its final report.', { role: str, task: str }, ['role', 'task'])
];
const SUB_TOOLS = TOOLS.filter(t => t.name !== 'spawn_subagent' && t.name !== 'update_plan');

async function runTool(name, a, depth) {
  switch (name) {
    case 'update_plan': S.arts.plan = (a.items || []).map(x => ({ text: String(x.text), done: !!x.done })); renderArts(); persist(); return 'Plan saved: ' + JSON.stringify(S.arts.plan);
    case 'list_dir': { const f = abs(a.path || '.'); return (await api.fs.list(f)).map(x => x.name + (x.dir ? '/' : '')).join('\n') || '(empty)'; }
    case 'read_file': { const f = abs(a.path); if (S.cfg.mode === 'strict' && outside(f) && !(await ask('طلب قراءة خارج مساحة العمل', f))) return 'USER DENIED'; return (await api.fs.read(f)).slice(0, 20000); }
    case 'write_file': return proposeChange(a.path, a.content);
    case 'run_command': {
      if (S.cfg.mode === 'strict' && !(await ask('الوكيل يطلب تنفيذ أمر', a.command + '\n\nالمجلد: ' + S.ws))) return 'USER DENIED this command.';
      showPane('term'); $('#tout').textContent += '\n[agent] $ ' + a.command + '\n';
      const r = await api.exec(a.command, S.ws); if (!api.electron) $('#tout').textContent += r.out + '\n';
      S.arts.logs.push({ cmd: a.command, code: r.code, out: r.out }); renderArts(); persist(); return `exit code ${r.code}\n${r.out}`;
    }
    case 'browser_open': await navTo(a.url); return 'Opened ' + a.url;
    case 'browser_read': {
      const r = await pageEval(`JSON.stringify({title:document.title,text:document.body.innerText.slice(0,3000),controls:[...document.querySelectorAll('button,a,input,select,textarea')].slice(0,40).map(e=>e.tagName.toLowerCase()+':'+(e.innerText||e.value||e.placeholder||e.id||'').slice(0,40))})`);
      return r + '\nConsole errors: ' + JSON.stringify(S.errs.filter(e => e.startsWith('Preview')).slice(-10));
    }
    case 'browser_eval': return String(await pageEval(a.script));
    case 'browser_screenshot': {
      if (!api.electron) return 'Screenshots are only available in the desktop app.';
      const img = await $('#pvv').capturePage(); S.arts.shots.push({ url: img.toDataURL() }); renderArts(); persist(); return 'Screenshot saved to Artifacts.';
    }
    case 'spawn_subagent': {
      if (depth > 0) return 'Subagents cannot spawn subagents.';
      say('sub', `⚙ Subagent «${a.role}» بدأ: ${a.task}`);
      const out = await agentLoop(`You are a focused subagent with role: ${a.role}. Workspace: ${S.ws}. Do only the delegated task, then reply with a concise final report.`, [{ role: 'user', content: a.task }], SUB_TOOLS, depth + 1);
      say('sub', `⚙ Subagent «${a.role}» انتهى.`); return out;
    }
  }
  return 'Unknown tool ' + name;
}

/* ============ استدعاء النماذج ============ */
async function llm(sys, msgs, tools) {
  const c = S.cfg, A = c.provider === 'claude'; let url, headers, body;
  const root = (c.base || (A ? 'https://api.anthropic.com' : 'https://generativelanguage.googleapis.com/v1beta/openai')).replace(/\/$/, '');
  if (A) {
    url = root + '/v1/messages';
    headers = { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    body = { model: c.model || 'claude-sonnet-5-5', max_tokens: 4096, system: sys, messages: msgs, tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
  } else {
    url = root + '/chat/completions'; headers = { 'content-type': 'application/json', authorization: 'Bearer ' + c.key };
    body = { model: c.model || 'gemini-2.5-pro', messages: [{ role: 'system', content: sys }, ...msgs], tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) };
  }
  const r = await api.http(url, { method: 'POST', headers, body: JSON.stringify(body) }); let j;
  try { j = JSON.parse(r.text); } catch (e) { throw new Error('HTTP ' + r.status + ': ' + r.text.slice(0, 300)); }
  if (r.status >= 400 || j.error) throw new Error(r.status + ': ' + JSON.stringify(j.error || j).slice(0, 400));
  if (A) return { text: j.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), calls: j.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input })), msg: { role: 'assistant', content: j.content } };
  const m = j.choices[0].message;
  return { text: m.content || '', calls: (m.tool_calls || []).map(t => ({ id: t.id, name: t.function.name, args: JSON.parse(t.function.arguments || '{}') })), msg: { ...m, role: 'assistant' } };
}
const toolMsgs = res => S.cfg.provider === 'claude'
  ? [{ role: 'user', content: res.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.out })) }]
  : res.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.out }));

async function agentLoop(sys, msgs, tools, depth) {
  for (let i = 0; i < 20; i++) {
    if (S.stop) return 'تم إيقاف الوكيل.';
    const r = await llm(sys, msgs, tools); msgs.push(r.msg);
    if (r.text) say(depth ? 'sub' : 'ai', r.text);
    if (!r.calls.length) return r.text;
    const res = [];
    for (const c of r.calls) {
      if (S.stop) break; say('tool', '🔧 ' + c.name + ' ' + JSON.stringify(c.args).slice(0, 90)); let out;
      try { out = await runTool(c.name, c.args || {}, depth); } catch (e) { out = 'ERROR: ' + e.message; addErr(c.name + ': ' + e.message); }
      res.push({ id: c.id, out: String(out).slice(0, 12000) });
    }
    if (S.stop) return 'تم إيقاف الوكيل.';
    msgs.push(...toolMsgs(res));
  }
  return 'تم بلوغ الحد الأقصى من الخطوات.';
}

/* ============ القواعد وسير العمل ============ */
async function readOpt(f) { try { return await api.fs.read(f); } catch (e) { return ''; } }
async function buildSystem() {
  let rules = S.cfg.rules ? '\n\n# Global rules\n' + S.cfg.rules : '';
  const g = await readOpt(abs('GEMINI.md')); if (g) rules += '\n\n# Workspace GEMINI.md\n' + g;
  try { for (const it of await api.fs.list(abs('.agents/rules'))) if (!it.dir) rules += `\n\n# Rule: ${it.name}\n` + await readOpt(abs('.agents/rules/' + it.name)); } catch (e) {}
  return `You are an autonomous coding agent inside "Antigravity Clone IDE". Workspace folder: ${S.ws}. Mode: ${S.cfg.mode}.
Process: 1) call update_plan with a checklist FIRST; 2) execute step by step using tools (read/write files, run commands, preview in the built-in browser and fix errors you observe); 3) update the plan as items are completed; 4) delegate research/testing to spawn_subagent when helpful; 5) finish with a short summary. Paths are relative to the workspace. The user may edit the plan; respect it. Reply in the user's language (Arabic by default).` + rules;
}
async function expandWorkflow(text) {
  const m = text.match(/^\/([\w\-\u0600-\u06FF]+)\s*(.*)$/s); if (!m) return text;
  const w = await readOpt(abs('.agents/workflows/' + m[1] + '.md')); return w ? `Follow this workflow:\n${w}\n\nUser input: ${m[2]}` : text;
}

/* ============ الإرسال ============ */
let HIST = [];
async function send() {
  const t = $('#prompt').value.trim(); if (!t || S.busy) return;
  if (!S.cfg.key) { say('err', 'أدخل مفتاح API أولًا من ⚙ الإعدادات.'); return settings(); }
  $('#prompt').value = ''; S.busy = true; S.stop = false; say('user', t);
  try { HIST.push({ role: 'user', content: await expandWorkflow(t) }); await agentLoop(await buildSystem(), HIST, TOOLS, 0); }
  catch (e) { say('err', 'خطأ: ' + e.message); addErr(e.message); HIST = []; }
  S.busy = false; persist();
}

/* ============ الإقلاع ============ */
(async () => { try {
  await initEditor(); mkPreview(); termInit();
  Object.assign(S.cfg, (await api.db.get('settings', 'cfg')) || {}); statusBar();
  const info = await api.db.info(); $('#stdb').textContent = 'DB: ' + info.name + ' • Editor: ' + ED.name; if (info.note) addErr(info.note);
  await openWs((await api.db.get('settings', 'lastWs')) || (await api.defaultWs()));
  $('#openws').onclick = async () => { const f = await api.pickFolder(); if (f) openWs(f); };
  $('#settings').onclick = settings; $('#send').onclick = send; $('#stop').onclick = () => { S.stop = true; };
  $('#mode').onclick = async () => { S.cfg.mode = S.cfg.mode === 'turbo' ? 'strict' : 'turbo'; await saveCfg(); };
  $('#pgo').onclick = () => navTo($('#purl').value); $('#purl').onkeydown = e => { if (e.key === 'Enter') navTo(e.target.value); };
  document.querySelectorAll('.btabs button').forEach(b => b.onclick = () => showPane(b.dataset.p));
  document.querySelectorAll('.atabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.atabs button').forEach(x => x.classList.toggle('on', x === b)); ['chat', 'arts', 'errs'].forEach(k => { $('#' + k).hidden = k !== b.dataset.a; }); });
  $('#prompt').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
    if (reviewResolve && e.altKey && e.key === 'Enter') { e.preventDefault(); reviewResolve(true); }
    if (reviewResolve && e.key === 'Escape') reviewResolve(false);
  });
} catch (e) { document.body.insertAdjacentHTML('afterbegin', '<pre style="color:#f85149;padding:10px;position:fixed;z-index:99;background:#0d1117;direction:ltr">' + esc(e.stack || e) + '</pre>'); } })();
