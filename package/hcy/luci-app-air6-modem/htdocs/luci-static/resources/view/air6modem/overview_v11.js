'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require air6modem.control_v1 as control';
'require air6modem.common_v2 as common';

/* 5G 模组总览（参考 luci-app-5gmodem 的信息密度重排）
 *
 * 版式：状态条（运营商/注册/频段/RAT + 关键指标）
 *       → 网络模式 + 频段集合（原厂/全频段，胶囊分组）
 *       → 信号 / 拨号 / 小区 / SIM
 *       → 工程诊断
 */

const callStatus = rpc.declare({ object: 'luci.air6modem', method: 'get_status', expect: {} });
let configuredApn = '';
const callApn = rpc.declare({ object: 'luci.air6modem', method: 'get_apn', expect: {} });
function displayApn(n) { return n.data?.nw_apn || configuredApn || '-'; }
const callCells = rpc.declare({ object: 'luci.air6modem', method: 'get_cells', expect: {} });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const runAt = rpc.declare({ object: 'luci.air6modem', method: 'run_at', params: [ 'command' ] });
const setRat = rpc.declare({ object: 'luci.air6modem', method: 'set_rat', params: [ 'mode' ] });
const ifup = rpc.declare({ object: 'luci.air6modem', method: 'ifup' });
const ifdown = rpc.declare({ object: 'luci.air6modem', method: 'ifdown' });

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

let LTE_FACTORY = [];
let LTE_FULL = [];
let NR_FACTORY = [];
let NR_FULL = [];

const RAT_MODES = [
	[ 21, '自动' ],
	[ 19, '4G + 5G' ],
	[ 15, '仅 5G' ]
];

let lastSample = null;
let trafficDevice = null;
let bandState = null;
const callBands = rpc.declare({ object: 'luci.air6modem', method: 'get_bands', expect: {} });
let currentBand = '';

function netValue(n, key) {
	let a = n?.[key];
	return Array.isArray(a) ? a.map(x => x.address ? `${x.address}/${x.mask}` : String(x)).join(' ') : '';
}

function shortRat(rat) {
	let t = String(rat || '').toUpperCase();
	if (t.indexOf('5G') >= 0 || t.indexOf('NR') >= 0) return '5G';
	if (t.indexOf('LTE') >= 0 || t.indexOf('4G') >= 0) return '4G';
	return t || _('未知');
}

function ratClass(rat) {
	let t = String(rat || '').toUpperCase();
	if (t.indexOf('5G') >= 0 || t.indexOf('NR') >= 0) return 'a6-badge a6-badge-5g';
	if (t.indexOf('LTE') >= 0 || t.indexOf('4G') >= 0) return 'a6-badge a6-badge-lte';
	return 'a6-badge a6-badge-off';
}

function ring(rsrp) {
	let pct = common.signalPercent(rsrp);
	let q = common.signalQuality(rsrp);
	return E('div', { 'class': 'a6-ring', id: 'a6-ring' }, [
		E('svg', { viewBox: '0 0 120 120' }, [
			E('defs', {}, E('linearGradient', { id: 'a6-ring-grad', x1: '0', y1: '0', x2: '1', y2: '1' }, [
				E('stop', { offset: '0%', 'stop-color': '#2f7cf6' }),
				E('stop', { offset: '100%', 'stop-color': '#41d1a7' })
			])),
			E('circle', { 'class': 'a6-ring-track', cx: 60, cy: 60, r: RING_R }),
			E('circle', {
				'class': 'a6-ring-fill', cx: 60, cy: 60, r: RING_R,
				'stroke-dasharray': `${RING_C}`,
				'stroke-dashoffset': `${RING_C * (1 - pct / 100)}`,
				stroke: '#2f7cf6'
			})
		]),
		E('div', { 'class': 'a6-ring-face' }, [
			E('span', { 'class': 'a6-ring-val', id: 'a6-rsrp' }, rsrp == null || rsrp === '' ? '--' : rsrp),
			E('span', { 'class': 'a6-ring-unit' }, 'dBm'),
			E('span', { 'class': 'a6-ring-cap ' + (q.cls || ''), id: 'a6-signal-cap' }, q.text)
		])
	]);
}

function bar(id, label, cls) {
	return E('div', { 'class': 'a6-bar-row' }, [
		E('span', {}, label),
		E('div', { 'class': 'a6-bar-track' }, E('div', { 'class': 'a6-bar-fill ' + cls, id: `${id}-bar` })),
		E('span', { 'class': 'a6-bar-val', id: `${id}-val` }, '0.0 Mbps')
	]);
}

function simLabel(sim) { return common.simText(sim); }

function updateRing(rsrp) {
	let pct = common.signalPercent(rsrp);
	let fill = document.querySelector('#a6-ring .a6-ring-fill');
	if (fill) fill.setAttribute('stroke-dashoffset', `${RING_C * (1 - pct / 100)}`);
	let val = document.getElementById('a6-rsrp');
	if (val) val.textContent = rsrp == null || rsrp === '' ? '--' : rsrp;
	let cap = document.getElementById('a6-signal-cap');
	if (cap) { let q = common.signalQuality(rsrp); cap.textContent = q.text; cap.className = 'a6-ring-cap ' + (q.cls || ''); }
}

function barPercent(bps) {
	let mbps = Math.max(0, bps || 0) * 8 / 1000000;
	return Math.min(100, Math.log1p(mbps) / Math.log1p(1000) * 100);
}

function updateTraffic(devices) {
	let stat = devices?.[trafficDevice]?.stats;
	let now = Date.now() / 1000, rx = +stat?.rx_bytes, tx = +stat?.tx_bytes;
	if (!Number.isFinite(rx) || !Number.isFinite(tx)) return;
	let down = 0, up = 0;
	if (lastSample && now > lastSample.time) {
		down = Math.max(0, (rx - lastSample.rx) / (now - lastSample.time));
		up = Math.max(0, (tx - lastSample.tx) / (now - lastSample.time));
	}
	lastSample = { time: now, rx, tx };
	for (let item of [ [ 'a6-down', down ], [ 'a6-up', up ] ]) {
		let fill = document.getElementById(`${item[0]}-bar`);
		let val = document.getElementById(`${item[0]}-val`);
		if (fill) fill.style.width = `${barPercent(item[1])}%`;
		if (val) val.textContent = common.formatRate(item[1]);
	}
}

function setText(id, value) {
	let el = document.getElementById(id);
	if (el) el.textContent = (value == null || value === '') ? '-' : '' + value;
}

function setBadge(id, rat) {
	let el = document.getElementById(id);
	if (!el) return;
	el.className = ratClass(rat);
	el.textContent = shortRat(rat);
}

function signalOf(data, key) {
	let m = String(data.cesq || '').match(new RegExp(`${key}=(-?[0-9.]+)`));
	return m ? m[1] : '';
}

function dnsList(network) {
	return (network?.['dns-server'] || []).slice(0, 2).join(' / ');
}

function gateway(network) {
	let route = (network?.route || []).find(r => r.target == '0.0.0.0');
	return route?.nexthop || '';
}

/* API 频段胶囊：区分当前允许与模组支持集合。 */
function pill(kind, band, on, extended) {
	return E('span', {
		'class': 'a6-pill' + (on ? ' a6-pill-on' : '') + (extended ? ' a6-pill-ext' : ''),
		'data-kind': kind, 'data-band': band,
		title: (kind == 'LTE' ? 'B' : 'n') + band + (on ? _('（当前允许）') : _('（模组支持）'))
	}, (kind == 'LTE' ? 'B' : 'n') + band);
}

function bandGroup(kind, full, factory) {
	let cur = currentBand;
	return E('div', { 'class': 'a6-pill-group' }, [
		E('span', { 'class': 'a6-pill-label' }, kind),
		E('div', { 'class': 'a6-pills' }, full.map(b => {
			let ext = factory.indexOf(b) < 0;
			let on = factory.includes(b);
			let isCur = String(cur).toUpperCase().replace(/^B|^N/, '') == String(b);
			let node = pill(kind, b, on, ext);
			if (isCur) node.classList.add('a6-pill-cur');

			return node;
		}))
	]);
}

function renderBands() {
	let box = document.getElementById('a6-bands');
	if (!box) return;
	while (box.firstChild) box.removeChild(box.firstChild);
	box.appendChild(bandGroup('LTE', LTE_FULL, LTE_FACTORY));
	box.appendChild(bandGroup('NR', NR_FULL, NR_FACTORY));

	let note = document.getElementById('a6-band-note');
	if (note) {
		note.textContent = _('蓝色为当前允许频段，虚线为模组上报支持但未启用的频段。');
	}
}

function renderCarriers(data) {
    let box = document.getElementById('a6-carriers');
    if (!box) return;
    box.replaceChildren();
    let errors = Object.entries(data?.api_errors || {}).filter(entry => entry[1] !== 0);
    let stale = data?.stale || data?.initializing;
    if (stale || errors.length)
        box.appendChild(E('p', { 'class': 'a6-note' }, stale
            ? _('数据已过期，等待模组更新')
            : _('部分查询失败：') + errors.map(entry => entry.join('=')).join(', ')));
    let carriers = data?.carriers || [];
    if (!carriers.length) {
        box.appendChild(E('p', { 'class': 'a6-note' }, _('暂无可用载波数据')));
        return;
    }
    let value = v => v == null ? '—' : String(v);
    let table = E('table', { 'class': 'table' }, [
        E('tr', { 'class': 'tr table-titles' },
            [_('载波'), _('频段'), 'PCI', 'ARFCN', _('下行 MHz'), _('上行 MHz'), _('状态')]
                .map(label => E('th', { 'class': 'th' }, label)))
    ]);
    carriers.forEach(carrier => {
        let secondary = carrier.role === 'SCC';
        let state = secondary ? (carrier.active === true ? _('已激活')
            : carrier.active === false ? _('已配置，未激活') : _('激活状态未知')) : _('主载波');
        table.appendChild(E('tr', { 'class': 'tr' }, [
            value(carrier.rat) + ' ' + value(carrier.role),
            (carrier.rat === 'NR' ? 'n' : 'B') + value(carrier.band),
            value(carrier.pci), value(carrier.arfcn), value(carrier.dl_bandwidth_mhz),
            value(carrier.ul_bandwidth_mhz), state
        ].map(text => E('td', { 'class': 'td' }, text))));
    });
    box.appendChild(E('div', { 'style': 'overflow-x:auto' }, table));
    box.appendChild(E('p', { 'class': 'a6-note' },
        _('副载波已配置不等于正在聚合传输；负载下需结合激活状态和独立流量判断。')));
}

function sessionRate(kbps) {
	return typeof kbps === 'number' && Number.isFinite(kbps) && kbps > 0
		? (kbps / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' Mbps'
		: _('未读取');
}

function sessionRateTile(ambr) {
	return E('div', { 'class': 'a6-tile a6-session-rate', title: _('运营商下发的当前上网会话速率上限') }, [
		E('small', {}, _('签约速率')),
		E('div', {}, [ E('span', {}, _('下行')), E('b', { id: 'a6-ambr-down' }, sessionRate(ambr?.downlink_kbps)) ]),
		E('div', {}, [ E('span', {}, _('上行')), E('b', { id: 'a6-ambr-up' }, sessionRate(ambr?.uplink_kbps)) ])
	]);
}

function applyStatus(data) {
	renderCarriers(data);
	if (!data || !data.available) return;

	let m = String(data.signal || '').match(/RSRP=(-?[0-9.]+)/);
	let rsrp = m ? m[1] : signalOf(data, 'RSRP');
	updateRing(rsrp);

	currentBand = data.band || '';
	setText('a6-op', common.operatorName(data.operator) || data.operator || _('未注册'));
	setText('a6-op-code', common.operatorName(data.operator) ? data.operator : '');
	setBadge('a6-rat', data.rat);
	setText('a6-reg', common.registrationText(data.registration));
	setText('a6-band-badge', data.band || '--');
	setText('a6-pci-badge', data.pci ? 'PCI ' + data.pci : '');
	setText('a6-live-note', data.initializing ? _('等待模组就绪…')
		: _('实时刷新 · %s 秒前').format(data.cache_age ?? '-'));

	setText('a6-t-rsrp', signalOf(data, 'RSRP'));
	setText('a6-t-rsrq', signalOf(data, 'RSRQ'));
	setText('a6-t-sinr', signalOf(data, 'SINR'));
	setText('a6-ambr-down', sessionRate(data.session_ambr?.downlink_kbps));
	setText('a6-ambr-up', sessionRate(data.session_ambr?.uplink_kbps));

	for (let [ id, cls ] of [
		[ 'a6-t-rsrp', common.valueQuality(rsrp, -85, -100) ],
		[ 'a6-t-rsrq', common.valueQuality(signalOf(data, 'RSRQ'), -10, -15) ],
		[ 'a6-t-sinr', common.valueQuality(signalOf(data, 'SINR'), 15, 0) ]
	]) {
		let el = document.getElementById(id);
		if (el) el.className = cls;
	}

	let n = data.network || {};
	setText('a6-conn', n.up ? _('已连接') : _('未连接'));
	setText('a6-apn', displayApn(n));
	setText('a6-ipv4', netValue(n, 'ipv4-address'));
	setText('a6-gw', gateway(n));
	setText('a6-dns', dnsList(n));
	setText('a6-uptime', n.up ? common.formatUptime(n.uptime) : '');
	setText('a6-iface', n.l3_device);

	setText('a6-strip-ip', netValue(n, 'ipv4-address').split(' ')[0] || '-');
	setText('a6-strip-uptime', n.up ? common.formatUptime(n.uptime) : '-');
	setText('a6-strip-temp', data.temperature ? data.temperature + ' °C' : '-');
	setText('a6-strip-apn', displayApn(n));
	for (let id of ['a6-apn', 'a6-strip-apn']) {
		let el = document.getElementById(id);
		if (el) el.title = n.data?.nw_apn ? _('连接上报的 APN') : _('已配置的 APN；连接未上报实际 APN');
	}

	setText('a6-band2', data.band);
	setText('a6-pci', data.pci);
	setText('a6-arfcn', data.arfcn);
	setText('a6-tac', data.tac);
	setText('a6-cellid', data.cellid);

	setText('a6-imei', data.imei);
	setText('a6-imsi', data.imsi);
	setText('a6-iccid', data.iccid);
	setText('a6-sim-state', simLabel(data.sim));
	setText('a6-temp', data.temperature ? `${data.temperature} °C` : '-');

	renderBands();

	let next = n.l3_device || null;
	if (next !== trafficDevice) { trafficDevice = next; lastSample = null; }
}

return view.extend({
	load() { return Promise.all([ callStatus(), callCells(), callApn() ]); },

	update(data) { applyStatus(data); },

	render(result) {
		let data = result[0] || {}, cells = result[1] || {};
		configuredApn = result[2]?.apn || '';
		let rsrp = signalOf(data, 'RSRP');
		let n = data.network || {};

		let page = E('div', { 'class': 'a6-page' }, [
			common.style(),
			E('style', {}, `
.a6-session-rate>div{display:flex;justify-content:space-between;gap:.35rem;font-size:.78rem;line-height:1.35}
.a6-session-rate>div+div{margin-top:.15rem}
.a6-session-rate span{opacity:.7}
.a6-session-rate b{font-variant-numeric:tabular-nums;white-space:nowrap}
.a6-strip{display:grid;grid-template-columns:minmax(0,1.2fr) repeat(4,minmax(0,.7fr));gap:1rem;align-items:center;
  padding:1rem 1.25rem;border-radius:1rem;border:1px solid color-mix(in srgb,currentColor 12%,transparent);
  background:color-mix(in srgb,currentColor 4%,transparent)}
@media(max-width:900px){.a6-session-rate>div{display:flex;justify-content:space-between;gap:.35rem;font-size:.78rem;line-height:1.35}
.a6-session-rate>div+div{margin-top:.15rem}
.a6-session-rate span{opacity:.7}
.a6-session-rate b{font-variant-numeric:tabular-nums;white-space:nowrap}
.a6-strip{grid-template-columns:1fr 1fr}}
.a6-strip-main{display:flex;align-items:center;gap:.9rem}
.a6-strip-op b{font-size:1.05rem}
.a6-strip-op small{display:block;opacity:.6;font-size:.78rem;margin-top:.15rem}
.a6-strip-kv small{display:block;opacity:.6;font-size:.74rem;margin-bottom:.15rem}
.a6-strip-kv b{font-size:.95rem;font-variant-numeric:tabular-nums;word-break:break-all}
.a6-bandline{display:flex;align-items:center;gap:.5rem;margin-top:.35rem;flex-wrap:wrap}
.a6-band-badge{display:inline-flex;align-items:center;padding:.15rem .55rem;border-radius:999px;font-weight:700;font-size:.82rem;
  background:color-mix(in srgb,#2f7cf6 20%,transparent);color:#2f7cf6}
.a6-mode-row{display:flex;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 .8rem}
.a6-mode{flex:0 0 auto}
.a6-pill-group{display:grid;grid-template-columns:3.2rem minmax(0,1fr);gap:.6rem;align-items:start;margin:.55rem 0}
.a6-pill-label{font-size:.8rem;opacity:.65;padding-top:.25rem}
.a6-pills{display:flex;flex-wrap:wrap;gap:.4rem}
.a6-pill{display:inline-flex;align-items:center;justify-content:center;min-width:3rem;padding:.28rem .55rem;border-radius:.55rem;
  font-size:.8rem;font-weight:600;border:1px solid color-mix(in srgb,currentColor 16%,transparent);
  color:color-mix(in srgb,currentColor 45%,transparent);cursor:default}
.a6-pill-on{background:linear-gradient(135deg,#2f7cf6,#3b82f6);border-color:transparent;color:#fff}
.a6-pill-cur{box-shadow:0 0 0 2px color-mix(in srgb,#41d1a7 70%,transparent)}
.a6-pill-ext{border-style:dashed}
.a6-pill-ext:not(.a6-pill-on){cursor:pointer}
.a6-band-state{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin-bottom:.4rem}
.a6-band-state b{font-weight:700}
`),

			/* 状态条 */

			/* 应用内导航：让五个页面看起来是同一个应用 */
			E('style', {}, '.a6-tabs{display:flex;gap:.3rem;flex-wrap:wrap;margin:.1rem 0 1rem;padding:.3rem;border-radius:.85rem;' +
				'background:color-mix(in srgb,currentColor 5%,transparent);border:1px solid color-mix(in srgb,currentColor 10%,transparent);width:fit-content}' +
				'.a6-tab{padding:.38rem .85rem;border-radius:.6rem;font-size:.84rem;font-weight:600;color:inherit;opacity:.62;text-decoration:none}' +
				'.a6-tab:hover{opacity:1;background:color-mix(in srgb,currentColor 9%,transparent)}' +
				'.a6-tab-on{opacity:1;color:#fff;background:#2f7cf6}'),
			E('style', {}, '.a6-logo{display:none!important}' +
				'.a6-badge-5g{background:#2f7cf6!important;color:#fff!important}' +
				'.a6-badge-lte{background:color-mix(in srgb,currentColor 10%,transparent)!important;color:inherit!important}' +
				'.a6-badge-off{background:color-mix(in srgb,#ef4444 14%,transparent)!important;color:#ef4444!important}' +
				'.a6-pill-on,.a6-tab-on,.a6-btn-primary{background:#2f7cf6!important;border-color:transparent!important;color:#fff!important}' +
				'.a6-title{font-weight:700}' +
				'.a6-card{box-shadow:none}'),
			(() => {
				let items = [ [ 'overview', _('概览') ], [ 'bands', _('频段') ], [ 'network', _('网络') ],
					[ 'sms', _('短信') ], [ 'terminal', _('调试') ] ];
				let base = location.pathname.replace(/\/+$/, '').split('/');
				return E('div', { 'class': 'a6-tabs' }, items.map(function(it) {
					let path = base.slice();
					path[path.length - 1] = it[0];
					return E('a', { 'class': 'a6-tab' + (it[0] == 'overview' ? ' a6-tab-on' : ''), href: path.join('/') }, it[1]);
				}));
			})(),
			E('div', { 'class': 'a6-strip' }, [
				E('div', { 'class': 'a6-strip-main' }, [
					ring(rsrp),
					E('div', { 'class': 'a6-strip-op' }, [
						E('b', { id: 'a6-op' }, common.operatorName(data.operator) || data.operator || _('未注册')),
						E('small', { id: 'a6-reg' }, common.registrationText(data.registration)),
						E('div', { 'class': 'a6-bandline' }, [
							E('span', { 'class': ratClass(data.rat), id: 'a6-rat' }, shortRat(data.rat)),
							E('span', { 'class': 'a6-band-badge', id: 'a6-band-badge' }, data.band || '--'),
							E('span', { 'class': 'a6-hero-code', id: 'a6-pci-badge' }, data.pci ? 'PCI ' + data.pci : '')
						])
					])
				]),
				E('div', { 'class': 'a6-strip-kv' }, [ E('small', {}, 'IPv4'), E('b', { id: 'a6-strip-ip' }, '-') ]),
				E('div', { 'class': 'a6-strip-kv' }, [ E('small', {}, _('在线时长')), E('b', { id: 'a6-strip-uptime' }, '-') ]),
				E('div', { 'class': 'a6-strip-kv' }, [ E('small', {}, _('模组温度')), E('b', { id: 'a6-strip-temp' }, '-') ]),
				E('div', { 'class': 'a6-strip-kv' }, [ E('small', {}, 'APN'), E('b', { id: 'a6-strip-apn' }, '-') ])
			]),

			/* 信号 + 速率 */
			E('div', { 'class': 'a6-grid-wide', 'style': 'margin-top:1rem' }, [
				common.card(_('信号与速率'), E('div', {}, [
					E('div', { 'class': 'a6-tiles' }, [
						common.tile('RSRP', signalOf(data, 'RSRP'), 'dBm', 'a6-t-rsrp'),
						common.tile('RSRQ', signalOf(data, 'RSRQ'), 'dB', 'a6-t-rsrq'),
						common.tile('SINR', signalOf(data, 'SINR'), 'dB', 'a6-t-sinr'),
						sessionRateTile(data.session_ambr)
					]),
					E('div', { 'class': 'a6-bars', 'style': 'margin-top:.8rem' }, [
						bar('a6-down', _('下行'), 'a6-down'),
						bar('a6-up', _('上行'), 'a6-up')
					])
				])),
				common.card(_('连接操作'), E('div', {}, [
					E('div', { 'class': 'a6-mode-row' }, [
						E('button', { 'class': 'a6-btn a6-btn-primary', click: ui.createHandlerFn(this, 'handleReconnect') }, '↻ ' + _('重新拨号')),
						E('button', { 'class': 'a6-btn', click: ui.createHandlerFn(this, 'handleRefresh') }, '⟳ ' + _('刷新状态'))
					]),
					E('p', { 'class': 'a6-note', id: 'a6-live-note' }, _('实时刷新'))
				]))
			]),

			/* 拨号 / 小区 / SIM */
			E('div', { 'class': 'a6-grid', 'style': 'margin-top:1rem' }, [
				common.card(_('拨号与网络'), common.kv([
					[ _('连接状态'), E('span', { id: 'a6-conn' }, n.up ? _('已连接') : _('未连接')) ],
					[ 'APN', E('span', { id: 'a6-apn' }, displayApn(n)) ],
					[ 'IPv4', E('span', { id: 'a6-ipv4' }, netValue(n, 'ipv4-address')) ],
					[ _('网关'), E('span', { id: 'a6-gw' }, gateway(n)) ],
					[ 'DNS', E('span', { id: 'a6-dns' }, dnsList(n)) ],
					[ _('在线时长'), E('span', { id: 'a6-uptime' }, n.up ? common.formatUptime(n.uptime) : '-') ],
					[ _('数据接口'), E('span', { id: 'a6-iface' }, n.l3_device) ]
				])),

				common.card(_('小区信息'), common.kv([
					[ _('频段'), E('span', { id: 'a6-band2' }, data.band) ],
					[ 'PCI', E('span', { id: 'a6-pci' }, data.pci) ],
					[ 'EARFCN', E('span', { id: 'a6-arfcn' }, data.arfcn) ],
					[ 'TAC', E('span', { id: 'a6-tac' }, data.tac) ],
					[ _('小区 ID'), E('span', { id: 'a6-cellid' }, data.cellid) ]
				])),

				common.card(_('模组与 SIM'), common.kv([
					[ 'IMEI', E('span', { id: 'a6-imei' }, data.imei) ],
					[ 'IMSI', E('span', { id: 'a6-imsi' }, data.imsi) ],
					[ 'ICCID', E('span', { id: 'a6-iccid' }, data.iccid) ],
					[ _('SIM 状态'), E('span', { id: 'a6-sim-state' }, simLabel(data.sim)) ],
					[ _('模组温度'), E('span', { id: 'a6-temp' }, data.temperature ? `${data.temperature} °C` : '-') ]
				]))
			]),

			common.card(_('载波聚合'), E('div', { id: 'a6-carriers' })),

			E('details', { 'class': 'a6-card', 'style': 'margin-top:1rem' }, [
				E('summary', { 'style': 'cursor:pointer;font-weight:600' }, _('工程诊断（原生 RIL API）')),
				E('pre', { 'class': 'a6-raw a6-cell-raw' },
					JSON.stringify(cells, null, 2))
			])
		]);

		trafficDevice = n.l3_device || null;
		poll.add(() => document.hidden ? null : callStatus().then(applyStatus), 10);
		poll.add(() => callDevices().then(updateTraffic), 3);
		poll.add(() => document.hidden ? null : callCells().then(c => {
            renderCarriers(c);
			let raw = page.querySelector('.a6-cell-raw');
			if (raw) raw.textContent = JSON.stringify(c || {}, null, 2);
		}), 60);

		requestAnimationFrame(() => applyStatus(data));

		return page;
	},

	handleRat(mode) {
		return setRat(mode).then(control.wait).then(r => {
			let ok = r && (r.code === 0 || /success/i.test(r.output || ''));
			ui.addNotification(null,
				E('p', {}, ok ? _('网络模式已切换，正在重新搜网…') : _('切换失败：') + common.resultText(r)),
				ok ? 'info' : 'danger');
			return callStatus().then(applyStatus);
		}).catch(e => common.callError(_('网络模式'), e));
	},

	handleReconnect() {
		return ifdown().then(() => ifup()).then(() => {
			ui.addNotification(null, E('p', {}, _('已重新拨号')), 'info');
			return callStatus().then(applyStatus);
		}).catch(e => common.callError(_('重新拨号'), e));
	},

	handleRefresh() {
		return Promise.all([ callStatus(), callCells() ]).then(r => {
			applyStatus(r[0]);
            renderCarriers(r[1]);
			let raw = document.querySelector('.a6-cell-raw');
			if (raw) raw.textContent = JSON.stringify(r[1] || {}, null, 2);
			this.refreshBands();
			ui.addNotification(null, E('p', {}, _('状态已刷新')));
		});
	},

	handleRefreshBands() { return this.refreshBands(); },

    refreshBands() {
        let node = document.getElementById('a6-band-set');
        return callBands().then(data => {
            if (data.current?.error !== 0 || data.supported?.error !== 0)
                throw new Error(data.error || _('频段查询不完整'));
            bandState = data;
            LTE_FACTORY = data.current.LTE || []; NR_FACTORY = data.current.NR || [];
            LTE_FULL = data.supported.LTE || []; NR_FULL = data.supported.NR || [];
            if (node) node.textContent = _('原生 API 频段集合');
            renderBands();
        }).catch(e => {
            if (node) node.textContent = _('查询失败：') + e.message;
        });
    },

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});



