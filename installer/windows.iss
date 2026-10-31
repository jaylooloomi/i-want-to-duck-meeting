#ifndef AppVersion
  #define AppVersion "0.3.4"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\dist\payload"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
[Setup]
AppId={{47E58D5A-13C9-41D9-B74B-52D4DD83FEE4}
AppName=Duck Meeting
AppVersion={#AppVersion}
AppPublisher=Arthur Wang
AppPublisherURL=https://github.com/jaylooloomi/i-want-to-duck-meeting
DefaultDirName={localappdata}\Programs\DuckMeeting
DefaultGroupName=Duck Meeting
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=DuckMeeting-{#AppVersion}-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Duck Meeting
CloseApplications=yes
RestartApplications=no
LicenseFile=..\LICENSE
SetupLogging=yes

[Tasks]
Name: "codex"; Description: "Install Codex skill"; Flags: checkedonce
Name: "claude"; Description: "Install Claude Code plugin (requires Claude CLI)"; Flags: unchecked
Name: "desktopicon"; Description: "Create desktop shortcut"; Flags: checkedonce

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Duck Meeting"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\installer\launch.vbs"""; WorkingDir: "{app}"
Name: "{autodesktop}\Duck Meeting"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\installer\launch.vbs"""; Tasks: desktopicon; WorkingDir: "{app}"
Name: "{group}\Check for updates"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\installer\launch.vbs"" update"; WorkingDir: "{app}"
Name: "{group}\Prepare speech recognition"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\installer\launch.vbs"" audio"; WorkingDir: "{app}"
Name: "{group}\Uninstall Duck Meeting"; Filename: "{uninstallexe}"

[UninstallDelete]
Type: files; Name: "{app}\installation.json"
Type: files; Name: "{app}\integration-receipt.json"
Type: files; Name: "{app}\plugin\skills\meet\SKILL.md"

[Code]
function RunManager(Command: String): Boolean;
var Code: Integer;
begin
  Result := Exec(ExpandConstant('{app}\runtime\node.exe'), '"' + ExpandConstant('{app}\installer\manage.js') + '" ' + Command, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\installation.json')) then
    if not RunManager('check {#AppVersion}') then Result := 'Close active recordings before upgrading. Downgrades are not supported. Your meeting data is preserved.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Target: String;
begin
  if CurStep = ssPostInstall then begin
    Target := 'none';
    if WizardIsTaskSelected('codex') then Target := 'codex';
    if WizardIsTaskSelected('claude') then begin
      if Target = 'codex' then Target := 'both' else Target := 'claude';
    end;
    if not RunManager('install ' + Target) then
      RaiseException('Integration setup failed. Check the Setup log, install the requested Agent CLI, and run Setup again. Meeting data was preserved.');
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := RunManager('check');
  if Result then Result := RunManager('uninstall');
  if not Result then MsgBox('Close active recordings and retry. Integration cleanup must finish before uninstalling.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then begin
    if MsgBox('Application removed. Keep recordings, meeting notes, models and browser sign-in data? Choose Yes to keep (recommended).', mbConfirmation, MB_YESNO or MB_DEFBUTTON1) = IDNO then begin
      if MsgBox('Permanently delete all Duck Meeting data in your local app data folder?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(ExpandConstant('{localappdata}\DuckMeeting\data'), True, True, True);
    end;
  end;
end;
