!macro customInstall
  SetShellVarContext all
  CreateDirectory "$APPDATA\Vay Tutor"
  CreateDirectory "$APPDATA\Vay Tutor\db"
  CreateDirectory "$APPDATA\Vay Tutor\logs"
  CreateDirectory "$APPDATA\Vay Tutor\files"
  nsExec::ExecToLog '"$INSTDIR\resources\redist\vc_redist.x64.exe" /install /quiet /norestart'
  Pop $0
  nsExec::ExecToLog 'schtasks /Create /F /TN "Vay Tutor" /SC ONLOGON /RL LIMITED /TR "$\"$INSTDIR\resources\start-supervisor.cmd$\""'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Vay Tutor" dir=in action=allow protocol=TCP localport=8443'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'schtasks /Delete /F /TN "Vay Tutor"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\Vay Tutor.exe" --stop'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Vay Tutor"'
  Pop $0
!macroend
