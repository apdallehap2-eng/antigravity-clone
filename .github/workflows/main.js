'use strict';
const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path'), fs = require('fs'), cp = require('child_process');
let win, store;
app.disableHardwareAcceleration(); // يمنع الشاشة الفارغة على Windows 7 وبطاقات الرسوم القديمة

/* ---------- طبقة التخزين: Realm أولاً، وإن تعذّر يُستخدم ملف JSON ---------- */
function jsonStore(file) {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(d)); fs.renameSync(file + '.tmp', file); };
  return {
    name: 'JSON (ملف محلي)',
    get: (c, k) => ((d[c] || {})[k] ?? null),
    set: (c, k, v) => { (d[c] = d[c] || {})[k] = v; save(); },
    list: c => Object.keys(d[c] || {}),
    del: (c, k) => { if (d[c]) { delete d[c][k]; save(); } }
  };
}
function realmStore(file) {
  const Realm = require('realm');
  const r = new Realm({
    path: file,
    schema: [{ name: 'Doc', primaryKey: '_id', properties: { _id: 'string', coll: 'string', data: 'string' } }]
  });
  return {
    name: 'Realm DB',
    get: (c, k) => { const o = r.objectForPrimaryKey('Doc', c + ':' + k); return o ? JSON.parse(o.data) : null; },
    set: (c, k, v) => r.write(() => { r.create('Doc', { _id: c + ':' + k, coll: c, data: JSON.stringify(v) }, 'modified'); }),
    list: c => r.objects('Doc').filtered('coll == $0', c).map(o => o._id.slice(c.length + 1)),
    del: (c, k) => r.write(() => { const o = r.objectForPrimaryKey('Doc', c + ':' + k); if (o) r.delete(o); })
  };
}
function initStore() {
  const dir = app.getPath('userData');
  try { store = realmStore(path.join(dir, 'antigravity.realm')); }
  catch (e) {
    store = jsonStore(path.join(dir, 'antigravity.json'));
    store.note = 'Realm غير متاح على هذا النظام، تم استخدام ملف JSON: ' + String(e.message).split('\n')[0];
  }
}

/* ---------- IPC ---------- */
const h = (n, f) => ipcMain.handle(n, (e, ...a) => f(...a));
h('db:get', (c, k) => store.get(c, k));
h('db:set', (c, k, v) => { store.set(c, k, v); return true; });
h('db:list', c => store.list(c));
h('db:del', (c, k) => { store.del(c, k); return true; });
h('db:info', () => ({ name: store.name, note: store.note || '' }));

h('fs:list', d => fs.readdirSync(d, { withFileTypes: true })
  .filter(x => x.name !== 'node_modules' && x.name !== '.git')
  .map(x => ({ name: x.name, dir: x.isDirectory() }))
  .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name)));
h('fs:read', f => fs.readFileSync(f, 'utf8'));
h('fs:write', (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return true; });
h('fs:exists', f => fs.existsSync(f));
h('dlg:folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
h('ws:default', () => { const d = path.join(app.getPath('documents'), 'AntigravityWorkspace'); fs.mkdirSync(d, { recursive: true }); return d; });

h('exec', (cmd, cwd) => new Promise(res => {
  const p = cp.spawn(cmd, { cwd, shell: true, windowsHide: true });
  let out = '';
  const push = d => { const s = d.toString(); out += s; if (win && !win.isDestroyed()) win.webContents.send('exec:data', s); };
  p.stdout.on('data', push); p.stderr.on('data', push);
  const t = setTimeout(() => p.kill(), 120000);
  p.on('close', code => { clearTimeout(t); res({ code, out: out.slice(-8000) }); });
  p.on('error', e => { clearTimeout(t); res({ code: -1, out: String(e) }); });
}));

h('http', (url, o) => new Promise(res => {
  const r = net.request({ url, method: o.method || 'POST' });
  for (const k in (o.headers || {})) r.setHeader(k, o.headers[k]);
  let t = '';
  r.on('response', x => { x.on('data', c => t += c); x.on('end', () => res({ status: x.statusCode, text: t })); });
  r.on('error', e => res({ status: 0, text: String(e) }));
  if (o.body) r.write(o.body);
  r.end();
}));

/* ---------- النافذة ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1000, minHeight: 600, backgroundColor: '#0d1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }
  });
  win.setMenuBarVisibility(false);
  const logf = path.join(app.getPath('userData'), 'log.txt');
  const log = m => { try { fs.appendFileSync(logf, new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} };
  const wc = win.webContents;
  wc.on('did-fail-load', (e, c, d, u) => { log('did-fail-load ' + c + ' ' + d + ' ' + u); dialog.showErrorBox('فشل تحميل الواجهة', c + ' ' + d + '\n' + u); });
  wc.on('render-process-gone', (e, d) => { log('render-process-gone ' + JSON.stringify(d)); dialog.showErrorBox('توقفت الواجهة', JSON.stringify(d)); });
  wc.on('console-message', (e, l, m, line, src) => { if (l >= 2) log('console: ' + m + ' @' + src + ':' + line); });
  wc.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && String(i.key).toUpperCase() === 'I'))) wc.toggleDevTools(); });
  win.loadFile(path.join(__dirname, 'src', 'index.html')).catch(err => { log('loadFile ' + err); dialog.showErrorBox('تعذّر فتح الواجهة', String(err)); });
}
app.whenReady().then(() => { initStore(); createWindow(); });
app.on('window-all-closed', () => app.quit());
