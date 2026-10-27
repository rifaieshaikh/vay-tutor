!macro customInstall
  SetShellVarContext all
  CreateDirectory "$APPDATA\Vay Tutor"
  CreateDirectory "$APPDATA\Vay Tutor\db"
  CreateDirectory "$APPDATA\Vay Tutor\logs"
  CreateDirectory "$APPDATA\Vay Tutor\files"
  nsExec::ExecToLog 'icacls "$APPDATA\Vay Tutor" /grant *S-1-5-32-545:(OI)(CI)M /T'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\resources\redist\vc_redist.x64.exe" /install /quiet /norestart'
  Pop $0
  nsExec::ExecToLog 'schtasks /Create /F /TN "Vay Tutor" /SC ONLOGON /RL LIMITED /TR "$\"$INSTDIR\resources\start-supervisor.cmd$\""'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Vay Tutor" dir=in action=allow protocol=TCP localport=8443'
  Pop $0

  # Always place a desktop shortcut for this computer and for the current user.
  SetShellVarContext all
  CreateShortCut "$DESKTOP\Vay Tutor.lnk" "$INSTDIR\Vay Tutor.exe" "" "$INSTDIR\Vay Tutor.exe" 0
  SetShellVarContext current
  CreateShortCut "$DESKTOP\Vay Tutor.lnk" "$INSTDIR\Vay Tutor.exe" "" "$INSTDIR\Vay Tutor.exe" 0
  SetShellVarContext all
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'schtasks /Delete /F /TN "Vay Tutor"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\Vay Tutor.exe" --stop'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Vay Tutor"'
  Pop $0
  SetShellVarContext all
  Delete "$DESKTOP\Vay Tutor.lnk"
  SetShellVarContext current
  Delete "$DESKTOP\Vay Tutor.lnk"
  SetShellVarContext all
!macroend
