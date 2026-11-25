'use strict';
'require baseclass';
'require rpc';
'require air6modem.common_v2 as common';

/* 一机一码解锁卡片：频段页内嵌。读取模组授权状态与机器码，提交 89 位解锁码。 */

const runAt = rpc.declare({ object: 'luci.air6modem', method: 'run_at', params: [ 'command' ] });

function parseBand(text) {
	const m = String(text || '').match(/\+AIR6BAND:\s*([^\r\n]*)/i);
	if (!m) return null;
	const out = {};
	m[1].trim().split(',').forEach(function(pair) {
		const i = pair.indexOf('=');
		if (i > 0) out[pair.slice(0, i).trim().toUpperCase()] = pair.slice(i + 1).trim();
	});
	return out;
}

function parseId(text) {
	const m = String(text || '').match(/\+AIR6BANDID:\s*([0-9a-fA-F]{64})/);
	return m ? m[1].toLowerCase() : '';
}

function licenseText(value) {
	const v = String(value || '').toUpperCase();
	if (v === 'VALID') return _('已授权');
	if (v === 'NONE') return _('未授权');
	return v || _('未知');
}

function licenseColor(value) {
	const v = String(value || '').toUpperCase();
	if (v === 'VALID') return '#16a34a';
	if (v === 'NONE') return '#ef4444';
	return 'inherit';
}

function rfText(value) {
	const v = String(value || '').toUpperCase();
	if (v === 'READY') return _('射频就绪');
	if (v === 'PENDING') return _('射频未就绪');
	return v || '-';
}

function applyStatus(band) {
	const lic = document.getElementById('a6-ba-license');
	const rf = document.getElementById('a6-ba-rf');
	const target = document.getElementById('a6-ba-target');
	if (lic) {
		lic.textContent = licenseText(band && band.LICENSE);
		lic.style.color = licenseColor(band && band.LICENSE);
		lic.style.fontWeight = '600';
	}
	if (rf) rf.textContent = rfText(band && band.RF);
	if (target) target.textContent = (band && band.TARGET) || '-';
}

function readAuthorization() {
	return runAt('AT+AIR6BAND?').catch(() => ({})).then(status =>
		runAt('AT+AIR6BANDID?').catch(() => ({})).then(id => [status, id]));
}

return baseclass.extend({
	load: readAuthorization,

	render(data, onUnlocked) {
		const bandRes = (data && data[0]) || {};
		const idRes = (data && data[1]) || {};
		const band = parseBand(bandRes.output || '');
		const machine = parseId(idRes.output || '');

		const result = E('div', { 'class': 'a6-raw', style: 'display:none' }, '');
		const input = E('textarea', {
			'class': 'a6-code-input',
			rows: '2',
			placeholder: 'A1.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
			spellcheck: 'false'
		});

		const note = (text, cls) => {
			result.style.display = '';
			result.textContent = text;
			result.style.color = cls === 'error' ? '#ef4444' : cls === 'ok' ? '#16a34a' : '';
		};

		const refresh = () => readAuthorization().then(([status, id]) => {
			const state = parseBand(status.output);
			applyStatus(state);
			const node = document.getElementById('a6-ba-machine');
			if (node) node.textContent = parseId(id.output) || _('未读取到机器码');
			return state;
		});

		let pendingBands = false;
		let busy = false;

		const syncBands = async state => {
			if (state?.LICENSE !== 'VALID' || state.RF !== 'READY') {
				note(_('授权已提交，射频就绪后请刷新状态'), '');
				return;
			}
			note(_('已授权，正在应用全部支持频段…'), '');
			try {
				await onUnlocked();
				pendingBands = false;
				note(_('已授权并应用全部支持频段'), 'ok');
			} catch (e) {
				note(_('已授权，频段应用未完成：') + e.message, 'error');
			}
		};

		const refreshAction = async () => {
			if (busy) return;
			busy = true;
			try {
				const state = await refresh();
				if (pendingBands) await syncBands(state);
			} finally {
				busy = false;
			}
		};

		const apply = async () => {
			if (busy) return;
			const code = String(input.value || '').trim();
			if (!/^A1\.[A-Za-z0-9_-]{86}$/.test(code)) {
				note(_('解锁码应为 A1. 开头的 89 位字符'), 'error');
				return;
			}
			busy = true;
			note(_('正在提交解锁码…'), '');
			try {
				const res = await runAt('AT+AIR6BAND="' + code + '"');
				const failure = parseBand(res?.output)?.FAILURE;
				const state = await refresh();
				if ((res?.code !== 0 || failure) &&
				    !(failure === 'RF_APPLY' && state?.LICENSE === 'VALID')) {
					note(failure === 'LICENSE_OR_STORAGE'
						? _('解锁失败，请核对本机机器码和解锁码')
						: _('模组暂时无法完成解锁，请重试'), 'error');
					return;
				}
				input.value = '';
				pendingBands = true;
				await syncBands(state);
			} catch (e) {
				note(_('提交失败，请重试'), 'error');
			} finally {
				busy = false;
			}
		};

		const copyMachine = () => {
			const node = document.getElementById('a6-ba-machine');
			const text = node ? node.textContent.trim() : '';
			if (!text || text === '-') return;
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).then(function() { note(_('机器码已复制'), 'ok'); });
			} else {
				input.value = text;
				input.select();
			}
		};

		const body = E('div', {}, [
			E('style', {}, `
.a6-machine{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.84rem;word-break:break-all;
  padding:.7rem .8rem;border-radius:.7rem;background:color-mix(in srgb,currentColor 7%,transparent);
  border:1px solid color-mix(in srgb,currentColor 12%,transparent);line-height:1.5}
.a6-code-input{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;
  padding:.6rem .7rem;border-radius:.7rem;border:1px solid color-mix(in srgb,currentColor 18%,transparent);
  background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;resize:vertical}
.a6-ba-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.9rem}
.a6-ba-label{font-size:.76rem;opacity:.6;margin-bottom:.25rem;display:block}
.a6-ba-value{font-size:.95rem;font-weight:600;word-break:break-all}
`),
			E('div', { 'class': 'a6-ba-grid' }, [
				E('div', {}, [ E('span', { 'class': 'a6-ba-label' }, _('授权状态')), E('div', { 'class': 'a6-ba-value', id: 'a6-ba-license' }, licenseText(band && band.LICENSE)) ]),
				E('div', {}, [ E('span', { 'class': 'a6-ba-label' }, _('射频状态')), E('div', { 'class': 'a6-ba-value', id: 'a6-ba-rf' }, rfText(band && band.RF)) ]),
				E('div', {}, [ E('span', { 'class': 'a6-ba-label' }, _('目标区域')), E('div', { 'class': 'a6-ba-value', id: 'a6-ba-target' }, (band && band.TARGET) || '-') ])
			]),
			E('span', { 'class': 'a6-ba-label', style: 'margin-top:.4rem' }, _('机器码')),
			E('div', { 'class': 'a6-machine', id: 'a6-ba-machine' }, machine || _('未读取到机器码')),
			E('div', { style: 'display:flex;gap:.5rem;margin-top:.55rem;flex-wrap:wrap' }, [
				E('button', { 'class': 'a6-btn', click: copyMachine }, _('复制机器码')),
				E('a', {
					'class': 'a6-btn',
					href: 'https://lic.tyflow.asia/air6lic/',
					target: '_blank',
					rel: 'noopener noreferrer'
				}, _('解锁请点击')),
				E('span', { 'class': 'a6-note', style: 'align-self:center' }, _('群号') + '：1127480894')
			]),
			E('p', { 'class': 'a6-note' }, _('一机一码：解锁码与机器码绑定，仅本机可用。')),
			E('span', { 'class': 'a6-ba-label', style: 'margin-top:.6rem' }, _('解锁码')),
			input,
			E('div', { style: 'display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap' }, [
				E('button', { 'class': 'a6-btn a6-btn-primary', click: apply }, _('解锁')),
				E('button', { 'class': 'a6-btn', click: refreshAction }, _('刷新状态'))
			]),
			result,
			E('p', { 'class': 'a6-note' }, _('解锁成功后建议重启设备，让模组重新加载射频配置。'))
		]);

		return common.card(_('一机一码'), body);
	}
});
