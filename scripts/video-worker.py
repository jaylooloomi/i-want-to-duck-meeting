"""FFmpeg guard and window enumeration. Standard library only; no capture on startup.

Windows Job Object contains FFmpeg. EOF or owner death ends capture; q finalizes.
"""
import ctypes
from ctypes import wintypes as W
import json
import os
import subprocess
import sys
import threading
import time


def windows():
    user = ctypes.windll.user32
    user.IsWindowVisible.argtypes = [W.HWND]
    user.IsIconic.argtypes = [W.HWND]
    user.GetWindowTextLengthW.argtypes = [W.HWND]
    user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, ctypes.c_int]
    user.GetClientRect.argtypes = [W.HWND, ctypes.POINTER(W.RECT)]
    user.GetWindowThreadProcessId.argtypes = [W.HWND, ctypes.POINTER(W.DWORD)]
    result = []
    callback = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

    @callback
    def visit(hwnd, _):
        if user.IsWindowVisible(hwnd) and not user.IsIconic(hwnd):
            length = user.GetWindowTextLengthW(hwnd)
            if length:
                title = ctypes.create_unicode_buffer(length + 1)
                user.GetWindowTextW(hwnd, title, length + 1)
                rect = W.RECT()
                user.GetClientRect(hwnd, ctypes.byref(rect))
                pid = W.DWORD()
                user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if rect.right > 1 and rect.bottom > 1:
                    result.append(dict(id=str(hwnd), pid=pid.value, title=title.value[:500],
                                       width=rect.right, height=rect.bottom))
        return True

    user.EnumWindows(visit, 0)
    print(json.dumps(result, ensure_ascii=True))


def run():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = W.HANDLE
    kernel.OpenProcess.restype = W.HANDLE
    kernel.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
    kernel.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
    kernel.CloseHandle.argtypes = [W.HANDLE]
    class BASIC(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                    ('flags', W.DWORD), ('min', ctypes.c_size_t), ('max', ctypes.c_size_t),
                    ('active', W.DWORD), ('affinity', ctypes.c_size_t), ('priority', W.DWORD), ('scheduling', W.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['read', 'write', 'other', 'read_bytes', 'write_bytes', 'other_bytes']]
    class EXTENDED(ctypes.Structure):
        _fields_ = [('basic', BASIC), ('io', IO), ('process_memory', ctypes.c_size_t),
                    ('job_memory', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
    owner = kernel.OpenProcess(0x100000, False, int(sys.argv[2]))  # SYNCHRONIZE
    if not owner:
        raise RuntimeError('Recording owner unavailable')
    job = kernel.CreateJobObjectW(None, None)
    info = EXTENDED()
    info.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise RuntimeError('Cannot contain recording process')
    child = None
    try:
        # Suspended launch prevents an uncontained encoder from starting capture.
        child = subprocess.Popen(sys.argv[3:], stdin=subprocess.PIPE, stdout=sys.stdout,
                                 stderr=sys.stderr, creationflags=0x08000000 | 0x00000004)
        if not kernel.AssignProcessToJobObject(job, W.HANDLE(int(child._handle))):
            raise RuntimeError('Cannot attach encoder to recording job')
        print('DUCK_ENCODER_PID=' + str(child.pid), flush=True)
        # NtResumeProcess resumes the suspended primary thread without an extra dependency.
        ntdll = ctypes.WinDLL('ntdll')
        ntdll.NtResumeProcess.argtypes = [W.HANDLE]
        if ntdll.NtResumeProcess(W.HANDLE(int(child._handle))) != 0:
            raise RuntimeError('Cannot resume recording encoder')
        closed = threading.Event()
        def stop_input():
            os.read(0, 1)
            closed.set()
        threading.Thread(target=stop_input, daemon=True).start()
        stopping = None
        while child.poll() is None:
            if stopping is None and (closed.is_set() or kernel.WaitForSingleObject(owner, 0) == 0):
                stopping = time.monotonic()
                try:
                    child.stdin.write(b'q\n')
                    child.stdin.flush()
                except (OSError, BrokenPipeError):
                    pass
            if stopping is not None and time.monotonic() - stopping > 15:
                child.kill()
            time.sleep(.1)
        return child.returncode
    finally:
        kernel.CloseHandle(job)
        kernel.CloseHandle(owner)
        if child and child.poll() is None:
            child.kill()
            child.wait()


if __name__ == '__main__':
    if os.name != 'nt':
        raise SystemExit('Windows only')
    if sys.argv[1:] == ['--windows']:
        windows()
    elif len(sys.argv) > 3 and sys.argv[1] == '--run':
        raise SystemExit(run())
    else:
        raise SystemExit('Invalid worker invocation')
