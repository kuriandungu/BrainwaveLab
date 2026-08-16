' Added by claude-code on 10thAug2026 at 12:54pm GMT+3. purpose: runs the PowerShell
' launcher fully hidden so the desktop shortcut opens with no console flash.
CreateObject("WScript.Shell").Run _
  "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\OneDrive\Personal\BrainwaveLab\launch-brainwavelab.ps1""", 0, False
