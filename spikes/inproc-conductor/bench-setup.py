"""Copy a Moss profile's conductor + keystore into two identical, offline
benchmark copies: one for the in-process addon, one for the sidecar binaries.

Usage: python3 bench-setup.py <moss-profile-dir> <bench-root>

Each copy is rewritten to point only at itself (lair pid/store/socket paths,
conductor data root). Bootstrap and relay are pointed at a dead local port so
the copied agents never reach real peers and cannot fork the original chains.
"""

import re
import shutil
import sys
from pathlib import Path

import yaml

profile = Path(sys.argv[1]).expanduser()
bench = Path(sys.argv[2]).resolve()
DEAD = "https://127.0.0.1:9"

for variant in ("i", "s"):
    root = bench / variant
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    shutil.copytree(profile / "data" / "conductor", root / "c")
    shutil.copytree(profile / "data" / "keystore", root / "k", ignore=shutil.ignore_patterns("socket", "pid_file"))
    shutil.copy(profile / "data" / ".pw", root / "pw")

    lair_cfg = root / "k" / "lair-keystore-config.yaml"
    text = lair_cfg.read_text()
    key = re.search(r"socket\?(k=[^\s]+)", text).group(1)
    socket_url = f"unix://{root / 'k' / 'socket'}?{key}"
    text = re.sub(r"(?m)^connectionUrl:.*$", f"connectionUrl: {socket_url}", text)
    text = re.sub(r"(?m)^pidFile:.*$", f"pidFile: {root / 'k' / 'pid_file'}", text)
    text = re.sub(r"(?m)^storeFile:.*$", f"storeFile: {root / 'k' / 'store_file'}", text)
    lair_cfg.write_text(text)

    cfg_path = root / "c" / "conductor-config.yaml"
    cfg = yaml.safe_load(cfg_path.read_text())
    cfg["data_root_path"] = str(root / "c")
    cfg["keystore"] = {"type": "lair_server", "connection_url": socket_url}
    cfg["admin_interfaces"] = [
        {"driver": {"type": "websocket", "port": 0, "allowed_origins": "*"}}
    ]
    net = cfg["network"]
    net["bootstrap_url"] = DEAD
    net["relay_url"] = DEAD
    adv = net.get("advanced") or {}
    adv.pop("mdnsBootstrap", None)
    adv.get("irohTransport", {}).pop("enableLanDiscovery", None)
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False))
    print(f"{variant}: {root}  socket path {len(str(root / 'k' / 'socket'))} bytes")
