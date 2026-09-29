; Valora NSIS window branding
; Keep the custom header artwork on the same right-side position as the original installer icon.
!define MUI_HEADERIMAGE_RIGHT
; Keep the installer executable icon separate from the setup window icon.

!define MUI_CUSTOMFUNCTION_GUIINIT ValoraSetWindowIcon
!define VALORA_LR_LOADFROMFILE 0x10
!define VALORA_LR_DEFAULTSIZE 0x40
!define VALORA_WM_SETICON 0x0080
!define VALORA_IMAGE_ICON 1
!define VALORA_WINDOW_ICON "${__FILEDIR__}\..\icons\icon.ico"

Function ValoraSetWindowIcon
  InitPluginsDir
  File "/oname=$PLUGINSDIR\valora-window.ico" "${VALORA_WINDOW_ICON}"

  System::Call 'USER32::LoadImage(p 0, t "$PLUGINSDIR\valora-window.ico", i ${VALORA_IMAGE_ICON}, i 16, i 16, i ${VALORA_LR_LOADFROMFILE}) p.r0'
  SendMessage $hWndParent ${VALORA_WM_SETICON} 0 $0

  System::Call 'USER32::LoadImage(p 0, t "$PLUGINSDIR\valora-window.ico", i ${VALORA_IMAGE_ICON}, i 0, i 0, i ${VALORA_LR_LOADFROMFILE}|${VALORA_LR_DEFAULTSIZE}) p.r0'
  SendMessage $hWndParent ${VALORA_WM_SETICON} 1 $0
FunctionEnd
