include $(TOPDIR)/rules.mk

PKG_NAME:=air6-boot-confirm
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=Air6

include $(INCLUDE_DIR)/package.mk

define Package/air6-boot-confirm
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Air6 A/B slot confirmation helper
  DEPENDS:=+air6-cpe-ui
endef

define Package/air6-boot-confirm/description
  Confirms the running A/B slot once userspace is healthy: clears the misc
  retry counter for that slot and pins it as the preferred boot target, so a
  reboot loop cannot drain the bootloader counter and fall back to the other
  slot. Needs air6-ui-slotctl from air6-cpe-ui.
endef

define Build/Compile
endef

define Package/air6-boot-confirm/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/usr/sbin/air6-boot-confirm $(1)/usr/sbin/air6-boot-confirm
	$(INSTALL_BIN) ./files/etc/init.d/air6-boot-confirm $(1)/etc/init.d/air6-boot-confirm
	$(INSTALL_BIN) ./files/etc/uci-defaults/91-air6-boot-confirm $(1)/etc/uci-defaults/91-air6-boot-confirm
endef

$(eval $(call BuildPackage,air6-boot-confirm))