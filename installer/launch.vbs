Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
mode = "desktop"
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)
If mode = "update" Then
  shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\installer\update.ps1""", 0, False
ElseIf mode = "audio" Then
  shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\installer\audio.ps1""", 1, False
Else
  shell.Run """" & root & "\runtime\node.exe"" """ & root & "\installer\desktop.js""", 0, False
End If
