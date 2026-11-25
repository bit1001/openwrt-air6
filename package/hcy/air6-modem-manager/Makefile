include $(TOPDIR)/rules.mk

PKG_NAME:=air6-modem-manager
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Air6 bring-up

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Air6 5G Modem Connection and Radio Manager
  DEPENDS:=+air6-modem-chain-only +jq
  PKGARCH:=all
endef

define Package/$(PKG_NAME)/description
Automated cellular connection management, band policy and radio intent controls for Air6.
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/etc/uci-defaults $(1)/usr/libexec
	$(INSTALL_CONF) ./root/etc/config/air6_modem $(1)/etc/config/air6_modem
	$(INSTALL_BIN) ./root/etc/init.d/air6-modem-manager $(1)/etc/init.d/air6-modem-manager
	$(INSTALL_BIN) ./root/etc/init.d/air6-radio-intent $(1)/etc/init.d/air6-radio-intent
	$(INSTALL_BIN) ./root/etc/uci-defaults/97-air6-own-modem-manager $(1)/etc/uci-defaults/97-air6-own-modem-manager

	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-band $(1)/usr/libexec/air6-modem-band
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-ca $(1)/usr/libexec/air6-modem-ca
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-control-job $(1)/usr/libexec/air6-modem-control-job
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-control-submit $(1)/usr/libexec/air6-modem-control-submit
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-policy $(1)/usr/libexec/air6-modem-policy
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-radio $(1)/usr/libexec/air6-modem-radio
	$(INSTALL_BIN) ./root/usr/libexec/air6-modem-rat $(1)/usr/libexec/air6-modem-rat
	$(INSTALL_BIN) ./root/usr/libexec/air6-radio-intent $(1)/usr/libexec/air6-radio-intent
	$(INSTALL_BIN) ./root/usr/libexec/air6-sim-net-unlock $(1)/usr/libexec/air6-sim-net-unlock
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/air6_modem
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
