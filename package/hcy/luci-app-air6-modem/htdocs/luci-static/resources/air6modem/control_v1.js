
'use strict';
'require baseclass';
'require rpc';
const status = rpc.declare({object:'luci.air6modem',method:'get_control',expect:{}});
function wait(result) {
    if (result?.status === 'pending') {
        let started = Date.now();
        function next() {
            return new Promise(resolve => window.setTimeout(resolve, 1500)).then(status).then(r => {
                if (r?.status !== 'pending') return finish(r);
                if (Date.now() - started > 180000)
                    throw new Error(_('操作仍未结束，请刷新后查看结果，勿重复提交。'));
                return next();
            });
        }
        return next();
    }
    return finish(result);
}
function finish(result) {
    if (result?.status != null)
        return {code: String(result.status) === '1' ? 0 : 5, output: result.message || result.error || ''};
    return result;
}
return baseclass.extend({wait:wait});
