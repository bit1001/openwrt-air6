# mtwifi-cfg-tool (prebuilt)

Provenance
----------
- `usr/sbin/mtwifi`, `usr/sbin/mwctl`: from the running Air6 QWRT image
  (`QWRT-R26.11.17-gem6xxx-mt6990-softbank_air6`), packages
  `mtwifi_cfg_tool` v8 and `mwctl`.
- `lib/wifi/mt_dbdc.sh`, `lib/netifd/wireless/mt_dbdc.sh`: same package.
- `lib/libubox.so.20240329`, `lib/libubus.so.20250102`: the exact sonames the
  daemon was linked against. The rest of this tree builds
  `libubox.so.20260523` / `libubus.so.20260628`; both versions coexist, so the
  daemon keeps its tested ABI instead of guessing cross-version compatibility.

Upstream source
---------------
The vendor builds this from `package/mtk/applications/mtwifi_cfg_tool`, which is
not part of this source export (see the `.gitignore` rule for
`package/mtk/mtwifi-cfg-tool/`). This package only redistributes the binaries so
that a self-built image has working Wi-Fi. If the source is ever obtained,
replace this package with a normal source build and drop the pinned libraries.

Licence
-------
No licence text accompanies the vendor binaries. Treat it as proprietary
MediaTek/QWRT material and remove the package before any public redistribution
that cannot accept that risk.