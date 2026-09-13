; 自定义 NSIS 钩子（electron-builder 自动加载 build/installer.nsh）
; 背景：v1.1.x 把存档放在安装目录 data 下，NSIS 升级安装会先卸载旧版并整目录删除，导致升级清档。
; customUnInstall 在卸载流程删除安装目录前执行：把旧版遗留存档备份到 %APPDATA%，随后新版首启可无缝接管。

!macro customUnInstall
  IfFileExists "$INSTDIR\data\saves\*.*" 0 vp_backup_done
    CreateDirectory "$APPDATA\变量协议\saves"
    CopyFiles /SILENT "$INSTDIR\data\saves\*.*" "$APPDATA\变量协议\saves"
  vp_backup_done:
!macroend
