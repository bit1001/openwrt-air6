#
# MediaTek MT7990 wireless control daemon, shipped as the vendor prebuilt.
#
# The corresponding source package (package/mtk/applications/mtwifi_cfg_tool)
# is not part of this source export, see README.md for provenance.
#
include $(TOPDIR)/rules.mk

PKG_NAME:=mtwifi-cfg-tool
PKG_VERSION:=8
PKG_RELEASE:=1

PKG_LICENSE:=Proprietary
PKG_LICENSE_FILES:=README.md
PKG_MAINTAINER:=Air6

include $(INCLUDE_DIR)/package.mk

define Package/mtwifi-cfg-tool
  SECTION:=net
  CATEGORY:=Network
  TITLE:=MediaTek MT7990 wireless control daemon (vendor prebuilt)
  DEPENDS:=+kmod-mt7990-wifi +libuci +libjson-c +libnl-tiny +hostapd-common +hostapd-openssl +hostapd-utils
  PKGARCH:=aarch64_cortex-a55_neon-vfpv4
endef

define Package/mtwifi-cfg-tool/description
  Ubiquitous "mtwifi" daemon that owns the MT7990 radios: it generates the
  per-BSS hostapd configuration, starts hostapd, and drives the driver through
  mwctl. Exposes the ubus service consumed by /lib/netifd/wireless/mt_dbdc.sh.
  Binaries are the vendor builds from the Air6 QWRT image; the source is not
  public, so this package redistributes them as-is.
endef

define Build/Compile
endef

define Package/mtwifi-cfg-tool/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/etc/rc.d
	$(INSTALL_DIR) $(1)/lib $(1)/lib/wifi $(1)/lib/netifd/wireless
	$(INSTALL_BIN) ./files/usr/sbin/mtwifi $(1)/usr/sbin/mtwifi
	$(INSTALL_BIN) ./files/usr/sbin/mwctl $(1)/usr/sbin/mwctl
	$(INSTALL_BIN) ./files/etc/init.d/mtwifi $(1)/etc/init.d/mtwifi
	$(INSTALL_BIN) ./files/lib/wifi/mt_dbdc.sh $(1)/lib/wifi/mt_dbdc.sh
	$(INSTALL_BIN) ./files/lib/netifd/wireless/mt_dbdc.sh $(1)/lib/netifd/wireless/mt_dbdc.sh
	$(INSTALL_DATA) ./files/lib/libubox.so.20240329 $(1)/lib/libubox.so.20240329
	$(INSTALL_DATA) ./files/lib/libubus.so.20250102 $(1)/lib/libubus.so.20250102
	$(LN) ../init.d/mtwifi $(1)/etc/rc.d/S19mtwifi
	$(LN) ../init.d/mtwifi $(1)/etc/rc.d/K20mtwifi
endef

$(eval $(call BuildPackage,mtwifi-cfg-tool))