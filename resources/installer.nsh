; Included by electron-builder's NSIS script (electron-builder.yml, nsis.include).

; The app registers bandal:// for itself on every launch
; (app.setAsDefaultProtocolClient), so uninstalling would leave a handler that
; points at a deleted Bandal.exe. Remove it, but only when it is this copy's
; and not during an update, after which the new version registers it again.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    ReadRegStr $0 HKCU "Software\Classes\bandal\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey HKCU "Software\Classes\bandal"
    ${endIf}
    Pop $0
  ${endIf}
!macroend
