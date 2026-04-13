"""
Backward-compatible re-export shim.

Pull and push logic now live in pull_ops.py and push_ops.py respectively.
This module re-exports everything so pull_configs.py and any other callers
that import from device_ops continue to work without changes.
"""
from .pull_ops import discover_devices, escape_to_menu, pull_single_device, pull_all_configs  # noqa: F401
from .push_ops import push_config_direct, push_via_console, erase_reload_direct, erase_reload_via_console  # noqa: F401

__all__ = [
    "discover_devices",
    "escape_to_menu",
    "pull_single_device",
    "pull_all_configs",
    "push_config_direct",
    "push_via_console",
    "erase_reload_direct",
    "erase_reload_via_console",
]
