!macro customInstall
  SetShellVarContext all
  CreateShortCut "$DESKTOP\Vay Tutor Client.lnk" "$INSTDIR\Vay Tutor Client.exe" "" "$INSTDIR\Vay Tutor Client.exe" 0
  SetShellVarContext current
  CreateShortCut "$DESKTOP\Vay Tutor Client.lnk" "$INSTDIR\Vay Tutor Client.exe" "" "$INSTDIR\Vay Tutor Client.exe" 0
  SetShellVarContext all
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  SetShellVarContext all
  Delete "$DESKTOP\Vay Tutor Client.lnk"
  SetShellVarContext current
  Delete "$DESKTOP\Vay Tutor Client.lnk"
  SetShellVarContext all
!macroend
