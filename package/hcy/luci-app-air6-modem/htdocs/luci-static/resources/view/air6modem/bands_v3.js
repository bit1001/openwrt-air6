'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require air6modem.control_v1 as control';
'require air6modem.common_v2 as common';
'require air6modem.bandauth_card as bandauth';

/* 网络模式与原生 API 频段集合。 */

const callCells = rpc.declare({ object: 'luci.air6modem', method: 'get_cells', expect: {} });
const getCa = rpc.declare({ object: 'luci.air6modem', method: 'get_ca', expect: {} });
const setCa = rpc.declare({ object: 'luci.air6modem', method: 'set_ca', params: [ 'mode' ], expect: {} });
const setRat = rpc.declare({ object: 'luci.air6modem', method: 'set_rat', params: [ 'mode' ] });

const setBands = rpc.declare({object:'luci.air6modem',method:'set_bands',params:['band_class','bands']});

const RAT_MODES = [ [ 21, '自动' ], [ 19, '4G + 5G' ], [ 15, '仅 5G' ] ];

const callBands = rpc.declare({ object: 'luci.air6modem', method: 'get_bands', expect: {} });

function readBands() {
	return callBands().then(data => {
		if (data.current?.error !== 0 || data.supported?.error !== 0 ||
		    !['LTE', 'NR'].every(rat => Array.isArray(data.current[rat]) && Array.isArray(data.supported[rat])))
			throw new Error(data.error || _('频段查询不完整'));
		return data;
	});
}

function bandGroup(kind, supported, current) {
	const all = [...new Set([...supported, ...current])].sort((a, b) => a - b);
	return E('div', { 'class': 'a6-pill-group' }, [
		E('span', { 'class': 'a6-pill-label' }, kind),
		E('div', { 'class': 'a6-pills' }, all.map(b => E('label', { 'class': 'a6-band-option' }, [
			E('input', { type: 'checkbox', 'data-band-class': kind, value: b,
				checked: current.includes(b) ? '' : null }),
			(kind === 'NR' ? 'n' : 'B') + b
		])))
	]);
}

return view.extend({
	load() { return bandauth.load(); },

	render(data) {
		const bandauthCard = bandauth.render(data, () => this.enableAllBands());
		let page = E('div', { 'class': 'a6-page' }, [
			common.style(),
			E('style', {}, `
.a6-pill-group{display:grid;grid-template-columns:3.2rem minmax(0,1fr);gap:.6rem;align-items:start;margin:.55rem 0}
.a6-pill-label{font-size:.8rem;opacity:.65;padding-top:.25rem}
.a6-pills{display:flex;flex-wrap:wrap;gap:.45rem .9rem}
.a6-band-option{display:inline-flex;align-items:center;gap:.35rem;padding:.15rem 0;margin:0;min-height:0;color:inherit;font-size:.85rem;cursor:pointer;background:transparent;border:0}
.a6-band-option input[type=checkbox]{margin:0}
.a6-pill{display:inline-flex;align-items:center;justify-content:center;min-width:3rem;padding:.28rem .55rem;border-radius:.55rem;
  font-size:.8rem;font-weight:600;border:1px solid color-mix(in srgb,currentColor 16%,transparent);
  color:color-mix(in srgb,currentColor 45%,transparent);cursor:default}
.a6-pill-on{background:linear-gradient(135deg,#2f7cf6,#3b82f6);border-color:transparent;color:#fff}
.a6-pill-cur{box-shadow:0 0 0 2px color-mix(in srgb,#41d1a7 70%,transparent)}
.a6-pill-ext{border-style:dashed}
.a6-pill-ext:not(.a6-pill-on){cursor:pointer}
.a6-band-state{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin-bottom:.4rem}
.a6-mode-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.a6-ca-limit{margin-top:.65rem}
.a6-ca-limit span{font-size:.85rem;margin-right:.25rem}
.a6-ca-controls button:disabled{cursor:default}
.a6-ca-controls button:disabled:not(.a6-btn-primary){opacity:.55}
`),
			E('div', { 'class': 'a6-head' }, [
				E('h2', { 'class': 'a6-title' }, [ _('频段与网络模式') ])
			]),
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
					return E('a', { 'class': 'a6-tab' + (it[0] == 'bands' ? ' a6-tab-on' : ''), href: path.join('/') }, it[1]);
				}));
			})(),

			common.card(_('网络模式'), E('div', {}, [
				E('div', { 'class': 'a6-mode-row' }, RAT_MODES.map(m => E('button', {
					'class': 'a6-btn', 'data-mode': m[0],
					click: ui.createHandlerFn(this, 'handleRat', m[0])
				}, m[1]))),
				E('p', { 'class': 'a6-note' }, _('切换后模组会重新搜网，数据会短暂中断。'))
			])),

			common.card(_('NR 载波聚合'), E('div', { id: 'a6-ca-controls', 'class': 'a6-ca-controls' },
				E('p', { role: 'status' }, _('正在读取载波聚合设置…')))),

			common.card(_('频段集合'), E('div', {}, [
				E('div', { 'class': 'a6-band-state' }, [
					E('b', { id: 'a6-band-set' }, '…'),
					E('button', { 'class': 'a6-btn', click: ui.createHandlerFn(this, 'handleRefreshBands') }, _('刷新频段'))
				]),
				E('div', { id: 'a6-bands' }),
                E('div', {'class':'a6-mode-row'}, ['LTE','NR'].map(rat => E('button', {
                    'class':'a6-btn', click:ui.createHandlerFn(this, function() {
                        if (this.enablingAllBands) return;
                        let bands=Array.from(document.querySelectorAll('input[data-band-class="'+rat+'"]:checked')).map(n=>+n.value);
                        if (!bands.length) return common.callError(_('频段设置'), new Error(_('至少选择一个频段')));
                        return setBands(rat,bands).then(control.wait).then(r=>{
                            if (r.code !== 0) throw new Error(r.output || r.error || _('设置失败'));
                            ui.addNotification(null,E('p',{},r.output));
                            return this.refresh();
                        }).catch(e=>common.callError(_('频段设置'),e));
                    })
                },_('应用')+' '+rat))),
				E('p', { 'class': 'a6-note', id: 'a6-band-note' }, _('读取中…'))
			])),

			common.card(_('周边小区'), E('div', {id:'a6-neighbor-cells'}, _('读取中…'))),

			bandauthCard
		]);

		poll.add(() => document.hidden ? null : this.refreshNeighbors(), 10);
		window.setTimeout(() => {
			this.refresh();
			this.refreshCa();
		}, 0);
		return page;
	},

	handleRat(mode) {
		return setRat(mode).then(control.wait).then(r => {
			let ok = r && (r.code === 0 || /success/i.test(r.output || ''));
			ui.addNotification(null, E('p', {}, ok ? _('网络模式已切换，正在重新搜网…') : _('切换失败：') + common.resultText(r)),
				ok ? 'info' : 'danger');
			return this.refresh();
		}).catch(e => common.callError(_('网络模式'), e));
	},

	async refreshCa() {
		try {
			const state = await getCa();
			if (state?.status !== '1' || typeof state.enabled !== 'boolean')
				throw new Error(state?.message || _('读取载波聚合设置失败'));
			this.caState = state;
			this.paintCa();
		} catch (e) {
			this.caState = null;
			this.paintCa(e.message);
		}
	},

	paintCa(error) {
		const box = document.getElementById('a6-ca-controls');
		if (!box) return;
		const state = this.caState;
		if (!state) {
			box.replaceChildren(E('div', { 'class': 'a6-mode-row' }, [
				E('span', { role: 'status' }, error || _('正在读取载波聚合设置…')),
				E('button', { type: 'button', 'class': 'a6-btn',
					click: ui.createHandlerFn(this, 'refreshCa') }, _('重试'))
			]));
			return;
		}

		const button = (mode, label, selected, unavailable) => E('button', {
			type: 'button',
			'class': 'a6-btn' + (selected ? ' a6-btn-primary' : ''),
			'aria-pressed': String(selected),
			disabled: this.caBusy || selected || unavailable || null,
			click: ui.createHandlerFn(this, 'handleCa', mode)
		}, label);
		const enabled = state.enabled;
		const rows = [
			E('div', { 'class': 'a6-mode-row', role: 'group', 'aria-label': _('NR 载波聚合开关') }, [
				button('on', _('开启'), enabled),
				button('off', _('关闭'), !enabled)
			])
		];
		if (enabled) {
			rows.push(E('div', { 'class': 'a6-mode-row a6-ca-limit', role: 'group', 'aria-label': _('下行载波上限') }, [
				E('span', {}, _('下行载波上限')),
				button('2', _('双载波'), state.max_cc === 2, state.fr1_limit < 2),
				button('3', _('三载波'), state.max_cc === 3, state.fr1_limit < 3),
				button('4', _('四载波'), state.max_cc === 4, state.fr1_limit < 4)
			]));
		}
		rows.push(E('p', { 'class': 'a6-note', role: 'status' }, this.caBusy ? _('正在保存并读取模组设置…') :
			(enabled && state.fr1_limit < 4 ? _('当前模组配置的 FR1 上限为 %d。').format(state.fr1_limit) :
				_('实际聚合载波由基站和模组支持的组合决定，改动可能在重新入网后生效。'))));
		box.replaceChildren(...rows);
	},

	async handleCa(mode) {
		if (this.caBusy) return;
		this.caBusy = true;
		this.paintCa();
		try {
			const result = await control.wait(await setCa(mode));
			if (result?.code !== 0)
				throw new Error(result?.output || result?.error || _('载波聚合设置失败'));
			ui.addNotification(null, E('p', {}, _('模组已确认载波聚合设置。')), 'info');
		} catch (e) {
			common.callError(_('NR 载波聚合'), e);
		} finally {
			this.caBusy = false;
			await this.refreshCa();
		}
	},

    handleRefreshBands() { return this.refresh(); },

    refresh() {
        return Promise.all([this.refreshBands(), this.refreshNeighbors()]);
    },

    refreshNeighbors() {
        return callCells().then(cells => this.paintNeighbors(cells));
    },

    refreshBands() {
        return readBands().then(data => this.paintBands(data)).catch(e => {
            let node = document.getElementById('a6-band-set');
            if (node) node.textContent = _('查询失败：') + e.message;
        });
    },

    async enableAllBands() {
        this.enablingAllBands = true;
        try {
            let data = await readBands();
            for (const rat of ['LTE', 'NR']) {
                const supported = data.supported[rat];
                if (!supported.length)
                    throw new Error(_('模组未上报支持的频段'));
                if (supported.every(band => data.current[rat].includes(band)))
                    continue;
                const result = await control.wait(await setBands(rat, supported));
                if (result?.code !== 0)
                    throw new Error(result?.output || result?.error || _('频段应用失败'));
                data = await readBands();
            }
            if (!['LTE', 'NR'].every(rat => data.supported[rat].every(band => data.current[rat].includes(band))))
                throw new Error(_('模组实际允许的频段未覆盖全部支持频段'));
            this.paintBands(data);
        } catch (e) {
            await this.refreshBands();
            throw e;
        } finally {
            this.enablingAllBands = false;
        }
    },

    paintNeighbors(data) {
        let box = document.getElementById('a6-neighbor-cells');
        if (!box) return;
        let cells = (data.cells || []).filter(c => c.role === 'neighbor');
        let show = v => v === null || v === undefined || v === '' ? '—' : String(v);
        let columns = [['rat', _('制式')], ['pci', 'PCI'], ['arfcn', 'ARFCN'], ['rsrp', 'RSRP (dBm)'], ['rsrq', 'RSRQ (dB)'], ['sinr', 'SINR (dB)']];
        box.replaceChildren(E('div', {style:'overflow-x:auto'}, [
            data.stale ? E('p', {'class':'a6-note'}, _('等待模组更新小区数据…')) : '',
            cells.length ? E('table', {'class':'table'}, [
                E('tr', {'class':'tr table-titles'}, columns.map(col => E('th', {'class':'th'}, col[1]))),
                ...cells.map(c => E('tr', {'class':'tr'}, columns.map(col => E('td', {'class':'td'}, show(c[col[0]])))))
            ]) : E('p', {'class':'a6-note'}, _('模组暂未上报周边小区。'))
        ]));
    },

	paintBands(data) {
		const node = document.getElementById('a6-band-set');
		if (node) node.textContent = _('原生 API 频段集合');
		const box = document.getElementById('a6-bands');
		if (!box) return;
		box.replaceChildren(...['LTE', 'NR'].map(rat => bandGroup(rat, data.supported[rat], data.current[rat])));
		const note = document.getElementById('a6-band-note');
		if (note) note.textContent = _('勾选以模组读回的允许频段为准。授权完成后自动应用全部支持频段，手动修改需点击应用。');
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
