"""run_quiet: a hung agent CLI must not hang the installer."""
import subprocess
import sys
import time

import pytest

from hrs_cli.proc import run_quiet


def test_returns_code_and_output():
    done = run_quiet([sys.executable, "-c", "import sys; print('да'); print('e', file=sys.stderr); sys.exit(3)"])
    assert (done.returncode, done.stdout.strip(), done.stderr.strip()) == (3, "да", "e")


def test_stdin_is_closed():
    assert run_quiet([sys.executable, "-c", "import sys; print(repr(sys.stdin.read()))"], timeout=20).stdout.strip() == "''"


def test_timeout_returns_even_when_a_child_keeps_running():
    child = "import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']); time.sleep(30)"
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        run_quiet([sys.executable, "-c", child], timeout=1)
    assert time.monotonic() - started < 15
