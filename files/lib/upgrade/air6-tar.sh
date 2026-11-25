#!/bin/sh
# AIR6 unsigned tar bundle, current-slot partial partition updates only.
RAMFS_COPY_BIN="$RAMFS_COPY_BIN head /usr/bin/sha256sum /usr/bin/ucode /usr/lib/ucode/fs.so"
RAMFS_COPY_DATA="$RAMFS_COPY_DATA /usr/share/air6-upgrade/tar.uc /tmp/air6-tar-plan.json /tmp/sysinfo/board_name"
air6_tar_check() { /usr/bin/ucode /usr/share/air6-upgrade/tar.uc check "$1"; }
