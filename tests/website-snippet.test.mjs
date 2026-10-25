import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('documented website snippet copies fresh state, survives rerender, and exposes a manual fallback', async () => {
    const markdown = await readFile(new URL('../docs/website-integration.uk.md', import.meta.url), 'utf8');
    const code = /<script>\s*([\s\S]*?)<\/script>/.exec(markdown)[1];
    const listeners = [], copied = [], calls = [];
    let denied = false, state = {charName: 'First'};
    const nodes = Object.fromEntries(['status', 'fallback', 'json'].map(key => [key, {focus() {}, select() { this.selected = true; }}]));
    const root = {querySelector: selector => nodes[selector.slice(14, -1)]};
    const button = {disabled: false, closest: () => root};
    const context = vm.createContext({window: {MASTER_DATA: {}, CBD: {}, CBSheet: {},
        get1d20FoundryExportState: () => state,
        D20FoundryExporter: {toJSON(options) { calls.push(options.state); return JSON.stringify(options.state); }}},
        document: {addEventListener: (_event, cb) => listeners.push(cb)},
        navigator: {clipboard: {async writeText(text) { if (denied) throw Error('Denied'); copied.push(text); }}}});
    vm.runInContext(code, context); vm.runInContext(code, context);
    assert.equal(listeners.length, 1);
    await listeners[0]({target: {closest: () => button}});
    assert.equal(JSON.parse(copied[0]).charName, 'First');
    state = {charName: 'Second'}; denied = true;
    await listeners[0]({target: {closest: () => ({...button})}});
    assert.equal(JSON.parse(nodes.json.value).charName, 'Second');
    assert.equal(nodes.fallback.hidden, false);
    assert.equal(nodes.json.selected, true);
    assert.equal(button.disabled, false);
    assert.equal(calls.length, 2);
});
