"""Run a short external command so that it can never hang the caller.

subprocess.run(capture_output=True, timeout=...) is not enough on Windows: agents' CLIs are .cmd scripts, the
timeout kills only cmd.exe, and then run() waits without a limit for the pipes that the surviving node.exe holds
open. Here the output goes to temporary files instead of pipes, stdin is closed so nothing can wait for an answer,
and a timeout takes down the whole process tree.
"""
import os
import subprocess
import tempfile


def _kill_tree(process: subprocess.Popen) -> None:
    if os.name == "nt":
        subprocess.call(["taskkill", "/T", "/F", "/PID", str(process.pid)], stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    process.kill()
    process.wait()


def run_quiet(cmd: list[str], timeout: float = 60) -> subprocess.CompletedProcess:
    """Like subprocess.run(cmd, capture_output=True, text=True, timeout=timeout). Raises TimeoutExpired."""
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        process = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=err)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(process)
            raise
        out.seek(0)
        err.seek(0)
        return subprocess.CompletedProcess(cmd, code, out.read().decode(errors="replace"),
                                           err.read().decode(errors="replace"))
