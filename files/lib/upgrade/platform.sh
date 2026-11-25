#!/bin/sh
. /lib/functions.sh
. /lib/upgrade/air6-tar.sh
# musl images do not necessarily install ldd. Enumerate without executing tools.
libs() {
    /lib/ld-musl-aarch64.so.1 --list "$@" 2>/dev/null |
        sed -E 's/(.* => )?(.*) .*/\2/'
}
REQUIRE_IMAGE_METADATA=0
REQUIRE_IMAGE_SIGNATURE=0
platform_check_image() { air6_tar_check "$1" >/dev/null; }
platform_do_upgrade() { /usr/bin/ucode /usr/share/air6-upgrade/tar.uc flash "$1"; }
