"""How busy the machine is, for the throughput log: the GPU's utilisation
(macOS reports it without privileges through ``ioreg``) and the load."""

import os
import re
import subprocess
import sys

_UTILISATION = re.compile(rb'"Device Utilization %"=(\d+)')


def gpu_utilisation() -> float | None:
    """The GPU's utilisation now, 0 to 1, or None where it cannot be read
    (not macOS, no accelerator)."""
    if sys.platform != "darwin":
        return None
    try:
        out = subprocess.run(
            ["ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"],
            capture_output=True,
            check=True,
            timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    found = _UTILISATION.search(out)
    return int(found.group(1)) / 100 if found else None


def load_average() -> float:
    """Runnable processes, averaged over the last minute."""
    return os.getloadavg()[0]
