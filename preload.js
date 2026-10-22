'use strict';
const { contextBridge, ipcRenderer: r } = require('electron');
const inv = n => (...a) => r.invoke(n, ...a);
contextBridge.exposeInMainWorld('api', {
  electron: true,
  db: { get: inv('db:get'), set: inv('db:set'), list: inv('db:list'), del: inv('db:del'), info: inv('db:info') },
  fs: { list: inv('fs:list'), read: inv('fs:read'), write: inv('fs:write'), exists: inv('fs:exists') },
  pickFolder: inv('dlg:folder'),
  defaultWs: inv('ws:default'),
  exec: inv('exec'),
  http: inv('http'),
  onExec: cb => r.on('exec:data', (e, s) => cb(s))
});
