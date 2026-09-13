// 应用内更新检查：共享最近一次检查结果（菜单红点 + 设置页展示），并缓存主进程推送的静默检查结果
let lastCheck = null

export function setLastCheck(info) {
  if (info?.ok) lastCheck = info
  return lastCheck
}

export function getLastCheck() {
  return lastCheck
}

export function hasUpdate() {
  return !!lastCheck?.updateAvailable
}

export async function checkUpdate() {
  const res = await window.api.checkUpdate()
  if (res?.ok) lastCheck = res
  return res
}
