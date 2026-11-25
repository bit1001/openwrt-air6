include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-air6-slot
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=Air6 bring-up

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI A/B slot management for Air6
  DEPENDS:=+luci-base +ucode +flock
  PKGARCH:=all
endef

define Package/$(PKG_NAME)/description
Web interface and management utilities for Air6 dual-slot (A/B) firmware switching.
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./root/usr/libexec/air6-luci-slotctl $(1)/usr/libexec/air6-luci-slotctl
	$(INSTALL_BIN) ./root/usr/libexec/air6-slot-manage $(1)/usr/libexec/air6-slot-manage

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-air6-slot.json $(1)/usr/share/luci/menu.d/luci-app-air6-slot.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-air6-slot.json $(1)/usr/share/rpcd/acl.d/luci-app-air6-slot.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/luci.air6slot $(1)/usr/share/rpcd/ucode/luci.air6slot

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/system
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/system/air6-slot.js $(1)/www/luci-static/resources/view/system/air6-slot.js
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
