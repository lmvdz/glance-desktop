; "Open in Glance" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  ; Pre-rename key name (glance-desktop was "terax") pointed at the old
  ; terax.exe binary, which no longer exists post-rename — remove it on
  ; upgrade so Explorer doesn't keep a dead "Open in Terax" entry around.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"

  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGlance" "" "Open in Glance"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGlance" "Icon" '"$INSTDIR\glance.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGlance" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInGlance\command" "" '"$INSTDIR\glance.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGlance" "" "Open in Glance"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGlance" "Icon" '"$INSTDIR\glance.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGlance" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInGlance\command" "" '"$INSTDIR\glance.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGlance" "" "Open in Glance"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGlance" "Icon" '"$INSTDIR\glance.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGlance" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInGlance\command" "" '"$INSTDIR\glance.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInGlance"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInGlance"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInGlance"
  ; Best-effort cleanup of the pre-rename keys too, in case an in-place
  ; upgrade never ran (fresh uninstall of an old install).
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"
!macroend
