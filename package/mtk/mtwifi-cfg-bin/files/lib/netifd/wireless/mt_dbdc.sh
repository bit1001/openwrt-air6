#!/bin/sh
#
# netifd wireless driver for the MediaTek MT7992 stack managed by this program.
#
# This replaces the vendor driver scripts (the Lua mtwifi.lua / mtkdat.lua
# stack reached through /lib/netifd/wireless/mtkwifi.sh) for the "mt_dbdc"
# hardware type. All radio work is delegated to the long-running "mtwifi" ubus
# service by invoking the program itself in command-client mode
# (/usr/sbin/mtwifi <cmd>), so this script only has to describe the UCI schema
# to netifd, drive up/down, and map every wifi-iface section to its real Linux
# VAP name.
#
# Why an "mt_dbdc" script name: netifd enumerates /lib/netifd/wireless/*.sh and
# binds a `config wifi-device` to a driver by matching its `type` option against
# the driver name reported here. luci-mod-network's wireless.js keys its MTK
# handling on `hwtype == 'mt_dbdc'`, so the emitted UCI type is "mt_dbdc" and it
# must have a matching netifd driver.
#
# netifd contract (see netifd wireless.c / handler.c):
#   discovery : <script> '' dump            -> prints one JSON object (see the
#                                             add_driver block below); the value
#                                             of "name" becomes the driver name.
#   setup     : <script> mt_dbdc setup <device-section> <json>
#   teardown  : <script> mt_dbdc teardown <device-section> <json>
# where <json> carries `config` (the wifi-device options) and `interfaces`
# (every wifi-iface bound to this device, each with its own `config`).
#
# The <device-section> is the UCI section name (e.g. MT7992_1_1). The client
# normalises dots to underscores, so either spelling resolves to the same radio
# in the ubus service.

. /lib/netifd/netifd-wireless.sh

# The same binary serves both as the daemon and as this thin command client;
# there is no separate wrapper script.
WIFI_MTK=/usr/sbin/mtwifi

# How long (in seconds) to wait for the mtwifi ubus service during boot. The
# init ordering starts this service (START=19) before S20network, so the
# wait is only a safety net against a slow/absent daemon.
MT_DBDC_SERVICE_WAIT=10

init_wireless_driver "$@"

# ---------------------------------------------------------------------------
# UCI schema forwarded by netifd.
#
# Only options declared here reach the JSON passed to setup(); everything else
# in /etc/config/wireless stays in UCI and is read directly by our program.
# The common set (_wdev_common_*_config) already covers
#   device : channel hwmode band htmode noscan
#   iface  : mode ssid encryption key
# so only the extras our naming/derivation needs are added below.
# ---------------------------------------------------------------------------

drv_mt_dbdc_init_device_config() {
	# main_ifname/apcli_ifname are written by this program's `detect`
	# (ra / rai / rax ...); band is consumed as a fallback only.
	config_add_string main_ifname apcli_ifname
	config_add_string country
	config_add_int txpower
	config_add_boolean disabled
}

drv_mt_dbdc_init_iface_config() {
	# bss_index is emitted per interface and is the authoritative source for
	# the VAP number; ifname allows an explicit override.
	config_add_string ifname
	config_add_int bss_index
	config_add_boolean disabled
}

drv_mt_dbdc_init_vlan_config() {
	:
}

drv_mt_dbdc_init_station_config() {
	config_add_string mac key vid iface
}

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_mt_dbdc_ap_prefix() {
	# Main VAP prefix per band (MT7992: 2.4G ra, 5G rai; 6G rax kept for
	# completeness). Defensive only: `detect` always writes main_ifname.
	case "$1" in
	2g) echo ra ;;
	5g) echo rai ;;
	6g) echo rax ;;
	*)  echo ra ;;
	esac
}

_mt_dbdc_apcli_prefix() {
	case "$1" in
	2g) echo apcli ;;
	5g) echo apclii ;;
	6g) echo apclix ;;
	*)  echo apcli ;;
	esac
}

# Make sure the mtwifi ubus service can be reached, starting it on demand.
# netifd sets the radios up as soon as it starts (S20network), i.e. before
# init.d runs S50mtwifi, so at the first setup the service is usually still
# absent. Failing here is not an option: netifd disables retries for MTK, so the
# device would stay "not active" even though the daemon lights the radios up.
_mt_dbdc_wait_service() {
	local i=0

	[ -x "$WIFI_MTK" ] || {
		echo "mt_dbdc: $WIFI_MTK is missing" >&2
		return 1
	}

	ubus list 2>/dev/null | grep -qx mtwifi && return 0
	[ -x /etc/init.d/mtwifi ] && /etc/init.d/mtwifi start >/dev/null 2>&1

	while [ "$i" -lt "$MT_DBDC_SERVICE_WAIT" ]; do
		ubus list 2>/dev/null | grep -qx mtwifi && return 0
		sleep 1
		i=$((i + 1))
	done

	echo "mt_dbdc: mtwifi ubus service is not running" >&2
	return 1
}

# ---------------------------------------------------------------------------
# driver entry points
# ---------------------------------------------------------------------------

drv_mt_dbdc_cleanup() {
	# Nothing per-driver to clean up here; radio state is owned by the ubus
	# service, which tears itself down on stop.
	:
}

drv_mt_dbdc_setup() {
	local device="$1"
	local main_ifname apcli_ifname band disabled

	# netifd always passes the device section name; refuse to guess otherwise
	# so we never drive the wrong (or a phantom) radio.
	[ -n "$device" ] || return 1

	json_select config
	json_get_vars main_ifname apcli_ifname band disabled
	json_select ..

	[ "$disabled" = "1" ] && return 0

	[ -n "$main_ifname" ] || main_ifname="$(_mt_dbdc_ap_prefix "$band")"
	[ -n "$apcli_ifname" ] || apcli_ifname="$(_mt_dbdc_apcli_prefix "$band")"

	_mt_dbdc_wait_service || {
		# The radio cannot be started yet. Do not ask netifd to retry
		# forever; the service reconciles all radios on its own start.
		wireless_setup_failed "BACKEND_UNAVAILABLE"
		return 1
	}

	# Bring the radio (and its main VAP) up. A non-zero return means the
	# radio genuinely failed; let netifd mark the device down. The service
	# re-converges every configured BSS when it (re)starts.
	if ! "$WIFI_MTK" up "$device"; then
		echo "mt_dbdc: failed to start $device" >&2
		wireless_setup_failed "DEVICE_UP_FAILED"
		return 1
	fi

	# Per-radio counters used while naming VAPs.
	mt_dbdc_main_ifname="$main_ifname"
	mt_dbdc_apcli_ifname="$apcli_ifname"
	mt_dbdc_ap_index=0
	mt_dbdc_sta_index=0

	wireless_set_data phy="$device"
	for_each_interface "ap" mt_dbdc_setup_vif
	for_each_interface "sta" mt_dbdc_setup_vif
	wireless_set_up
}

# Called by for_each_interface() with the UCI section name as $1. Registers the
# section -> Linux ifname mapping with netifd so its status (and therefore
# LuCI's iwinfo lookups) can resolve the running VAP.
mt_dbdc_setup_vif() {
	local section="$1"
	local mode disabled ifname bss_index

	json_select config
	json_get_vars mode disabled ifname bss_index
	json_select ..

	[ "$disabled" = "1" ] && return 0

	case "$mode" in
	sta)
		ifname="${mt_dbdc_apcli_ifname}${mt_dbdc_sta_index}"
		mt_dbdc_sta_index=$((mt_dbdc_sta_index + 1))
		;;
	*)
		if [ -z "$ifname" ]; then
			if [ -n "$bss_index" ]; then
				ifname="${mt_dbdc_main_ifname}${bss_index}"
			else
				ifname="${mt_dbdc_main_ifname}${mt_dbdc_ap_index}"
			fi
		fi
		mt_dbdc_ap_index=$((mt_dbdc_ap_index + 1))
		;;
	esac

	[ -n "$ifname" ] || ifname="$section"

	wireless_add_vif "$section" "$ifname"
}

drv_mt_dbdc_teardown() {
	local device="$1"

	# A failing teardown must never wedge netifd; the service owns the real
	# radio state and can be re-converged on the next setup.
	[ -n "$device" ] || return 0
	[ -x "$WIFI_MTK" ] || return 0
	"$WIFI_MTK" down "$device" >/dev/null 2>&1 || true

	return 0
}

add_driver mt_dbdc
