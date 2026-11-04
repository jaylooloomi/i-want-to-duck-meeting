"""Own synthetic GDI window for HWND capture tests; never captures the desktop."""
import ctypes as C
from ctypes import wintypes as W
import json
import os
import threading

user = C.WinDLL('user32')
gdi = C.WinDLL('gdi32')
kernel = C.WinDLL('kernel32')
PROC = C.WINFUNCTYPE(C.c_ssize_t, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
class CLASS(C.Structure):
    _fields_ = [('style', W.UINT), ('proc', PROC), ('extra', C.c_int), ('winextra', C.c_int),
                ('instance', W.HINSTANCE), ('icon', W.HICON), ('cursor', W.HANDLE), ('brush', W.HBRUSH),
                ('menu', W.LPCWSTR), ('name', W.LPCWSTR)]
user.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
user.DefWindowProcW.restype = C.c_ssize_t
user.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, C.c_int, C.c_int,
                               C.c_int, C.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID]
user.CreateWindowExW.restype = W.HWND
user.GetDC.argtypes = [W.HWND]
user.GetDC.restype = W.HDC
user.ReleaseDC.argtypes = [W.HWND, W.HDC]
user.GetClientRect.argtypes = [W.HWND, C.POINTER(W.RECT)]
user.FillRect.argtypes = [W.HDC, C.POINTER(W.RECT), W.HBRUSH]
user.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
user.ShowWindow.argtypes = [W.HWND, C.c_int]
user.SetTimer.argtypes = [W.HWND, C.c_size_t, W.UINT, C.c_void_p]
user.DestroyWindow.argtypes = [W.HWND]
user.ValidateRect.argtypes = [W.HWND, C.c_void_p]
user.GetMessageW.argtypes = [C.POINTER(W.MSG), W.HWND, W.UINT, W.UINT]
gdi.CreateSolidBrush.argtypes = [W.DWORD]
gdi.CreateSolidBrush.restype = W.HBRUSH
gdi.DeleteObject.argtypes = [W.HANDLE]
kernel.GetModuleHandleW.restype = W.HINSTANCE

@PROC
def procedure(hwnd, message, wp, lp):
    if message in (0x000F, 0x0113):
        dc = user.GetDC(hwnd)
        rect = W.RECT()
        user.GetClientRect(hwnd, C.byref(rect))
        brush = gdi.CreateSolidBrush(0x00CC6633)  # RGB(51,102,204), known test pixels
        user.FillRect(dc, C.byref(rect), brush)
        gdi.DeleteObject(brush)
        user.ReleaseDC(hwnd, dc)
        if message == 0x000F:
            user.ValidateRect(hwnd, None)
        return 0
    if message == 0x0010:
        user.DestroyWindow(hwnd)
        return 0
    if message == 0x0002:
        user.PostQuitMessage(0)
        return 0
    return user.DefWindowProcW(hwnd, message, wp, lp)

instance = kernel.GetModuleHandleW(None)
name = 'DuckVideoSyntheticFixture'
cls = CLASS(0, procedure, 0, 0, instance, None, None, None, None, name)
if not user.RegisterClassW(C.byref(cls)):
    raise RuntimeError('Cannot register synthetic test window')
hwnd = user.CreateWindowExW(0x08000000, name, 'Duck Meeting — synthetic capture fixture',
                            0x00CF0000, 100, 100, 340, 240, None, None, instance, None)
if not hwnd:
    raise RuntimeError('Cannot create synthetic test window')
user.ShowWindow(hwnd, 4)  # no activation
user.SetTimer(hwnd, 1, 100, None)
print(json.dumps({'id': str(hwnd), 'pid': os.getpid(), 'title': 'Synthetic capture fixture'}), flush=True)
def finish():
    os.read(0, 1)
    user.PostMessageW(hwnd, 0x0010, 0, 0)
threading.Thread(target=finish, daemon=True).start()
msg = W.MSG()
while user.GetMessageW(C.byref(msg), None, 0, 0) > 0:
    user.TranslateMessage(C.byref(msg))
    user.DispatchMessageW(C.byref(msg))
