// 预加载脚本：向渲染进程暴露存档与窗口接口
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  readSave: (file) => ipcRenderer.invoke('save:read', file),
  writeSave: (file, data) => ipcRenderer.invoke('save:write', file, data),
  deleteSave: (file) => ipcRenderer.invoke('save:delete', file),
  setMini: (mini) => ipcRenderer.invoke('window:setMini', mini),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  // 数据目录（存档保存位置）
  getDataDir: () => ipcRenderer.invoke('data:getDir'),
  chooseDataDir: () => ipcRenderer.invoke('data:chooseDir'),
  resetDataDir: () => ipcRenderer.invoke('data:resetDir'),
  // 应用内更新检查（GitHub Releases）
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openReleasePage: () => ipcRenderer.invoke('update:openRelease'),
  onUpdateFound: (cb) => ipcRenderer.on('update:found', (_e, info) => cb(info)),
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
  petSetIgnore: (flag) => ipcRenderer.invoke('pet:setIgnore', flag)
})
