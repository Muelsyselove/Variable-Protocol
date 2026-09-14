// 预加载脚本：向渲染进程暴露存档与窗口接口
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  readSave: (file) => ipcRenderer.invoke('save:read', file),
  writeSave: (file, data) => ipcRenderer.invoke('save:write', file, data),
  deleteSave: (file) => ipcRenderer.invoke('save:delete', file),
  setMini: (mini) => ipcRenderer.invoke('window:setMini', mini),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  // 数据目录（存档保存位置）
  getDataDir: () => ipcRenderer.invoke('data:getDir'),
  chooseDataDir: () => ipcRenderer.invoke('data:chooseDir'),
  resetDataDir: () => ipcRenderer.invoke('data:resetDir'),
  // 应用内更新检查（服务器优先 / GitHub Releases 兜底）
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openReleasePage: () => ipcRenderer.invoke('update:openRelease'),
  onUpdateFound: (cb) => ipcRenderer.on('update:found', (_e, info) => cb(info)),
  // 开屏覆盖层（主窗口内）：自动下载安装新版本
  onDownloadProgress: (cb) => ipcRenderer.on('update:downloadProgress', (_e, p) => cb(p)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  // 桌宠悬浮窗（主窗口侧）
  petOpen: () => ipcRenderer.invoke('pet:open'),
  petClose: () => ipcRenderer.invoke('pet:close'),
  petPush: (data) => ipcRenderer.invoke('pet:push', data),
  onPetAction: (cb) => ipcRenderer.on('pet:action', (_e, action) => cb(action)),
  // 桌宠悬浮窗（桌宠窗侧）
  onPetState: (cb) => ipcRenderer.on('pet:state', (_e, data) => cb(data)),
  petAction: (action) => ipcRenderer.invoke('pet:action', action),
  petDragStart: () => ipcRenderer.invoke('pet:dragStart'),
  petDragEnd: () => ipcRenderer.invoke('pet:dragEnd'),
  petSetIgnore: (flag) => ipcRenderer.invoke('pet:setIgnore', flag),
  // 资源包（数据+图片，与游戏核心分离，可独立更新）
  resourceInfo: () => ipcRenderer.invoke('res:info'),
  resourceImageMap: () => ipcRenderer.invoke('res:imageMap'),
  resourceRepair: () => ipcRenderer.invoke('res:repair'),
  // 个人后台服务器（占位：未配置服务器时全部禁用）
  serverStatus: () => ipcRenderer.invoke('server:status'),
  serverLogin: (payload) => ipcRenderer.invoke('server:login', payload),
  serverRegister: (payload) => ipcRenderer.invoke('server:register', payload),
  serverLogout: () => ipcRenderer.invoke('server:logout'),
  cloudPush: () => ipcRenderer.invoke('cloud:push'),
  cloudPull: () => ipcRenderer.invoke('cloud:pull'),
  checkResourceUpdate: (current) => ipcRenderer.invoke('server:checkResourceUpdate', current),
  applyResourceUpdate: (update) => ipcRenderer.invoke('server:applyResourceUpdate', update)
})
