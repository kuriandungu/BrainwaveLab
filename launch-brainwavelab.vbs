' Added by claude-code on 10thAug2026 at 12:54pm GMT+3. purpose: runs the PowerShell
' launcher fully hidden so the desktop shortcut opens with no console flash.
' Edited on 16Aug2026: resolve the .ps1 next to this script instead of a hardcoded path.
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run _
"powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\launch-brainwavelab.ps1""", 0, False
