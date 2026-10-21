$ErrorActionPreference = 'Stop'
# Native OS registration only: no key presses, clipboard access or microphone.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DictationHotkeyQa {
  [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
  [DllImport("user32.dll", SetLastError=true)] static extern bool UnregisterHotKey(IntPtr window, int id);
  public static int[] Run() {
    const int firstId=0x6A31, secondId=0x6A32;
    const uint modifiers=0x0002|0x0001|0x0004|0x4000; // Ctrl, Alt, Shift, no repeat
    bool first=false, second=false;
    try {
      first=RegisterHotKey(IntPtr.Zero,firstId,modifiers,0x7A); // F11
      if(!first) throw new InvalidOperationException("QA shortcut was already occupied; existing registration was left unchanged. Win32="+Marshal.GetLastWin32Error());
      second=RegisterHotKey(IntPtr.Zero,secondId,modifiers,0x7A);
      int collision=second?0:Marshal.GetLastWin32Error();
      if(second) { UnregisterHotKey(IntPtr.Zero,secondId); second=false; throw new InvalidOperationException("Windows unexpectedly accepted a duplicate shortcut."); }
      bool removed=UnregisterHotKey(IntPtr.Zero,firstId); first=!removed;
      if(!removed) throw new InvalidOperationException("Could not release the QA shortcut.");
      second=RegisterHotKey(IntPtr.Zero,secondId,modifiers,0x7A);
      if(!second) throw new InvalidOperationException("Released shortcut could not be registered again.");
      bool removedAgain=UnregisterHotKey(IntPtr.Zero,secondId); second=!removedAgain;
      if(!removedAgain) throw new InvalidOperationException("Could not release the second QA registration.");
      return new int[]{1,collision,1,1};
    } finally {
      if(first) UnregisterHotKey(IntPtr.Zero,firstId);
      if(second) UnregisterHotKey(IntPtr.Zero,secondId);
    }
  }
}
'@
$taskResult = [DictationHotkeyQa]::Run()
$taskReport = [ordered]@{
  date = [DateTime]::UtcNow.ToString('o')
  source = 'Windows RegisterHotKey/UnregisterHotKey in a controlled helper process'
  shortcut = 'Ctrl+Alt+Shift+F11'
  registered = $taskResult[0] -eq 1
  collisionRejected = $taskResult[1] -eq 1409
  collisionWin32Error = $taskResult[1]
  unregistered = $taskResult[2] -eq 1
  reusableAfterRelease = $taskResult[3] -eq 1
  physicalMicrophone = $false
  clipboardAccess = $false
  inputInjection = $false
  tauriHandlerOrWidgetVerified = $false
}
if (-not $taskReport.collisionRejected) { throw "Unexpected collision error: $($taskResult[1])" }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = Join-Path $taskRoot '.tmp/qa/dictation-native-registration.json'
[IO.Directory]::CreateDirectory((Split-Path -Parent $taskOutput)) | Out-Null
[IO.File]::WriteAllText($taskOutput, ($taskReport | ConvertTo-Json -Depth 5) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
$taskReport | ConvertTo-Json -Depth 5
