import test from 'node:test';
import assert from 'node:assert/strict';
import {initTranslationUI, translationActions, runTranslationAction} from '../scripts/translation-ui.js';
import {buildUpdate, revertItem} from '../scripts/translate.js';

const id = '1d20-ua-plutonium';
const callbacks = new Map();
const notices = [];
globalThis.Hooks = {on: (name, cb) => callbacks.set(name, cb)};
globalThis.game = {system: {version: '6.0.3'}, packs: new Map(), i18n: {localize: key => key, format: (key, values) => `${key}:${values.count}`},
    settings: {get: (_id, key) => ({nameMode: 'uk', translateMode: 'never', baseUrl: `modules/${id}/data`, attributionLink: false, convertRolls: false})[key]}};
globalThis.ui = {notifications: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, text => notices.push([level, text])]))};
globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('manifest.json')
    ? {version: 'test', uk: {spells: {file: 'spells.json'}}}
    : {entries: [{name_en: 'Shield', source: 'PHB', name_uk: 'Щит', slug: 'shield-phb', html: {entries: '<p>Переклад</p>'}}]}));

function apply(doc, update) {
    for (const [path, value] of Object.entries(update)) {
        const keys = path.split('.');
        let target = doc;
        for (const key of keys.slice(0, -1)) target = target[key] ??= {};
        const last = keys.at(-1);
        if (last.startsWith('-=')) delete target[last.slice(2)];
        else target[last] = structuredClone(value);
    }
}
function item() {
    return {id: 'item', documentName: 'Item', isOwner: true, name: 'Shield',
        system: {description: {value: '<p>Original</p>'}, uses: {spent: 2, max: '4'}, activities: {cast: {type: 'utility'}}},
        flags: {plutonium: {page: 'spells.html', source: 'PHB', hash: 'shield_phb'}, [id]: {spellOrigin: {kind: 'class'}, customResource: {index: 0}}},
        async update(data) { this.writes = (this.writes ?? 0) + 1; apply(this, data); }};
}
initTranslationUI();

test('modern three-dot controls and legacy buttons dispatch translation and restore without duplication', async () => {
    const doc = item(), controls = [];
    callbacks.get('getHeaderControlsApplicationV2')({document: doc}, controls);
    callbacks.get('getHeaderControlsApplicationV2')({document: doc}, controls);
    assert.equal(controls.length, 1);
    await controls[0].onClick();
    assert.equal(doc.name, 'Щит');
    assert.equal(doc.system.description.value, '<p>Переклад</p>');
    assert.equal(doc.flags[id].spellOrigin.kind, 'class');
    const buttons = [];
    callbacks.get('getApplicationHeaderButtons')({object: doc}, buttons);
    callbacks.get('getApplicationV1HeaderButtons')({object: doc}, buttons);
    assert.equal(buttons.length, 1);
    assert(buttons[0].label.endsWith('RestoreOriginal'));
    await buttons[0].onclick();
    assert.equal(doc.name, 'Shield');
    assert.equal(doc.system.description.value, '<p>Original</p>');
    assert.equal(doc.flags[id].spellOrigin.kind, 'class');
    assert.equal(doc.flags[id].customResource.index, 0);
    assert.equal(doc.flags[id].original, undefined);
    assert.deepEqual(doc.system.uses, {spent: 2, max: '4'});
    assert.deepEqual(doc.system.activities, {cast: {type: 'utility'}});
    await runTranslationAction(doc, 'translate');
    await revertItem(doc);
    assert.equal(doc.system.description.value, '<p>Original</p>');
});

test('item row menus use the context API of each system version', () => {
    const hook = callbacks.get('dnd5e.getItemContextOptions');
    for (const version of ['5.3.3', '6.0.3']) {
        game.system.version = version;
        const entries = [];
        hook(item(), entries);
        assert.equal(entries.length, 1);
        assert.equal(typeof (version.startsWith('5') ? entries[0].callback : entries[0].onClick), 'function');
        assert.equal(entries[0].icon.startsWith('<i'), version.startsWith('5'));
    }
});

test('owned character sheets expose spell-list completion, other actors do not', () => {
    const actor = {documentName: 'Actor', type: 'character', isOwner: true};
    assert(translationActions(actor).some(action => action.id === 'spells'));
    assert(!translationActions({...actor, type: 'npc'}).some(action => action.id === 'spells'));
    assert.deepEqual(translationActions({...actor, isOwner: false}), []);
});

test('translate all batches eligible items and skips custom or already translated entries', async () => {
    const first = item(), existing = item(), custom = item();
    existing.id = 'translated';
    apply(existing, buildUpdate(existing, {name_en: 'Shield', name_uk: 'Щит', html: {entries: 'Existing'}}, 'spells'));
    custom.id = 'custom'; custom.flags = {};
    const writes = [];
    const actor = {documentName: 'Actor', isOwner: true, items: [first, existing, custom], async updateEmbeddedDocuments(type, updates) { writes.push({type, updates}); }};
    const controls = [];
    callbacks.get('getHeaderControlsApplicationV2')({document: actor}, controls);
    assert(controls[0].label.endsWith('TranslateAll'));
    await controls[0].onClick();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].updates.length, 1);
    assert.equal(writes[0].updates[0]._id, 'item');
    assert(notices.some(([, message]) => message.endsWith(':1')));
});

test('read-only documents and locked compendia cannot invoke updates; missing translations report a warning', async () => {
    const doc = item();
    doc.isOwner = false;
    assert.deepEqual(translationActions(doc), []);
    await runTranslationAction(doc, 'translate');
    assert.equal(doc.writes, undefined);
    doc.isOwner = true; doc.pack = 'locked'; game.packs.set('locked', {locked: true});
    assert.deepEqual(translationActions(doc), []);
    await runTranslationAction(doc, 'translate');
    assert.equal(doc.writes, undefined);
    delete doc.pack; doc.flags = {};
    await runTranslationAction(doc, 'translate');
    assert.equal(notices.at(-1)[0], 'warn');
});
