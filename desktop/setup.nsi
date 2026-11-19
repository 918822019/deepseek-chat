Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!include "WinVer.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define APP_NAME "Chat Demo (WebView2)"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatDemoWebView2"
!define WEBVIEW2_KEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

Name "${APP_NAME}"
OutFile "${OUTPUT}"
Icon "${ROOT}\desktop\icon.ico"
UninstallIcon "${ROOT}\desktop\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\Chat Demo WebView2"
AutoCloseWindow true
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Chat Demo (WebView2)"
VIAddVersionKey "FileDescription" "Chat Demo WebView2 setup"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 DeepSeek"

Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LoadLanguageFile "${NSISDIR}\Contrib\Language files\SimpChinese.nlf"

LangString Unsupported ${LANG_ENGLISH} "Chat Demo needs 64-bit Windows 10 or Windows 11 and .NET Framework 4.8."
LangString Unsupported ${LANG_SIMPCHINESE} "Chat Demo 需要 64 位 Windows 10 或 Windows 11，并启用 .NET Framework 4.8。"
LangString RuntimeFailed ${LANG_ENGLISH} "The Microsoft WebView2 Runtime could not be installed. Check your internet connection and run setup again."
LangString RuntimeFailed ${LANG_SIMPCHINESE} "无法安装 Microsoft WebView2 运行时。请检查网络连接后重新运行安装程序。"

Function .onInit
  ${IfNot} ${AtLeastWin10}
  ${OrIfNot} ${RunningX64}
    Goto unsupported
  ${EndIf}
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
  IntCmpU $0 528040 ready unsupported ready
unsupported:
  MessageBox MB_ICONSTOP "$(Unsupported)" /SD IDOK
  Abort
ready:
  SetRegView 32
FunctionEnd

Function FindWebView2
  ReadRegStr $0 HKLM "${WEBVIEW2_KEY}" "pv"
  StrCmp $0 "" checkUser
  StrCmp $0 "0.0.0.0" checkUser found
checkUser:
  ReadRegStr $0 HKCU "${WEBVIEW2_KEY}" "pv"
  StrCmp $0 "" missing
  StrCmp $0 "0.0.0.0" missing found
missing:
  StrCpy $0 ""
found:
FunctionEnd

Section
  Call FindWebView2
  StrCmp $0 "" 0 app
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${STAGE}\MicrosoftEdgeWebview2Setup.exe"
  ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
  Call FindWebView2
  StrCmp $0 "" 0 app
  MessageBox MB_ICONSTOP "$(RuntimeFailed)" /SD IDOK
  SetErrorLevel 1
  Abort
app:
  SetOutPath "$INSTDIR"
  File "${STAGE}\app\ChatDemo.exe"
  File "${STAGE}\app\ChatDemo.exe.config"
  File "${STAGE}\app\Microsoft.Web.WebView2.Core.dll"
  File "${STAGE}\app\Microsoft.Web.WebView2.WinForms.dll"
  File "${STAGE}\app\WebView2Loader.dll"
  File "${STAGE}\app\WebView2-LICENSE.txt"
  File "${STAGE}\app\WebView2-NOTICE.txt"
  File "${ROOT}\LICENSE"
  SetOutPath "$INSTDIR\dist"
  File /r "${ROOT}\dist\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\ChatDemo.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\ChatDemo.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\ChatDemo.exe"
  IfSilent done
  ExecShell "open" "$INSTDIR\ChatDemo.exe"
done:
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$INSTDIR\ChatDemo.exe"
  Delete "$INSTDIR\ChatDemo.exe.config"
  Delete "$INSTDIR\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\WebView2-LICENSE.txt"
  Delete "$INSTDIR\WebView2-NOTICE.txt"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\dist"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
