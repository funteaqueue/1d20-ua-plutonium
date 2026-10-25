import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {featureHashKey, loadPack, find, hashKey, refresh} from '../scripts/data.js';
import {describeSource, translateActor, initTranslationHooks} from '../scripts/translate.js';
import {runTranslationAction} from '../scripts/translation-ui.js';
import {createPlutoniumCharacterAdapter} from '../scripts/character-plutonium.js';

const id = '1d20-ua-plutonium';
const root = new URL('../data/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const packs = Object.fromEntries(['classfeatures', 'subclassfeatures', 'optionalfeatures'].map(type =>
    [type, JSON.parse(fs.readFileSync(new URL(`uk/${type}.json`, root)))]));
let servedManifest = manifest, mode = 'always';
const hooks = new Map();
globalThis.Hooks = {on: (name, fn) => hooks.set(name, fn)};
globalThis.game = {system: {id: 'dnd5e', version: '6.0.3'}, user: {id: 'gm'}, packs: new Map(),
    modules: new Map([['plutonium', {active: true}]]),
    i18n: {localize: key => key, format: (key, args) => `${key}:${args.count}`},
    settings: {get: (_id, key) => ({baseUrl: `modules/${id}/data`, translateMode: mode, nameMode: 'uk', attributionLink: false, convertRolls: false})[key]}};
globalThis.fetch = async url => new Response(JSON.stringify(url.endsWith('manifest.json') ? servedManifest : packs[url.match(/uk\/(\w+)\.json/)[1]]));
globalThis.ui = {notifications: {info() {}, warn() {}, error(message) { throw new Error(message); }}};
function apply(doc, update) {
    for (const [path, value] of Object.entries(update)) {
        const keys = path.split('.'); let target = doc;
        for (const key of keys.slice(0, -1)) target = target[key] ??= {};
        const last = keys.at(-1);
        if (last.startsWith('-=')) delete target[last.slice(2)];
        else target[last] = structuredClone(value);
    }
    return doc;
}
globalThis.foundry = {utils: {mergeObject: apply}};
initTranslationHooks();

const row = (type, name, source) => packs[type].entries.find(e => e.name_en === name && (!source || e.source === source));
function document(type, entry) {
    const key = type === 'optionalfeatures' ? hashKey(entry.name_en, entry.source) : featureHashKey(type, entry.uid);
    return {id: key, documentName: 'Item', isOwner: true, name: entry.name_en,
        type: 'feat', system: {description: {value: '<p>Original linked description</p>'}, uses: {max: '3', spent: 2}, activities: {native: {type: 'utility'}}},
        effects: [{name: 'Native automation'}], flags: {plutonium: {page: {classfeatures: 'classFeature', subclassfeatures: 'subclassFeature', optionalfeatures: 'optionalfeatures.html'}[type], hash: key, source: entry.source}, [id]: {customResource: {index: 2}}},
        async update(data) { apply(this, data); }, updateSource(data) { apply(this, data); }};
}

test('feature UIDs expand PHB and inherited source defaults without losing class, subclass or level', () => {
    assert.equal(featureHashKey('classfeatures', ' Rage | Barbarian ||1'), 'rage_barbarian_phb_1_phb');
    assert.equal(featureHashKey('classfeatures', 'Rage|Barbarian|XPHB|1'), 'rage_barbarian_xphb_1_xphb');
    assert.equal(featureHashKey('classfeatures', 'Bardic Versatility|Bard||4|TCE|Display'), 'bardic%20versatility_bard_phb_4_tce');
    assert.equal(featureHashKey('subclassfeatures', 'Improved Critical|Fighter||Champion||3'), 'improved%20critical_fighter_phb_champion_phb_3_phb');
    assert.equal(featureHashKey('subclassfeatures', 'Feature|Fighter|XPHB|Subclass|TCE|3'), 'feature_fighter_xphb_subclass_tce_3_tce');
    assert.notEqual(featureHashKey('classfeatures', 'Expertise|Bard||2'), featureHashKey('classfeatures', 'Expertise|Rogue||2'));
    assert.notEqual(featureHashKey('classfeatures', 'Expertise|Bard||2'), featureHashKey('classfeatures', 'Expertise|Bard||9'));
    for (const uid of ['', 'Rage|Barbarian', 'Rage|Barbarian||bad']) assert.equal(featureHashKey('classfeatures', uid), null);
});

test('every bundled feature has a unique native composite hash and a verified pack checksum', async () => {
    for (const type of ['classfeatures', 'subclassfeatures']) {
        const pack = packs[type], meta = manifest.uk[type];
        assert.equal(createHash('sha1').update(fs.readFileSync(new URL(meta.file, root))).digest('hex'), meta.sha1);
        const index = await loadPack(type);
        assert.equal(index.size, pack.entries.length);
        assert.equal(index.size, meta.count);
        for (const entry of pack.entries) {
            // The published fields follow UrlUtil.URL_TO_HASH_BUILDER in both Plutonium generations.
            const parts = type === 'classfeatures'
                ? [entry.name_en, entry.className, entry.classSource, entry.level, entry.source]
                : [entry.name_en, entry.className, entry.classSource, entry.subclassShortName, entry.subclassSource, entry.level, entry.source];
            const nativeHash = parts.map(v => encodeURIComponent(String(v).toLowerCase()).toLowerCase()).join('_');
            assert.equal(featureHashKey(type, entry.uid), nativeHash, entry.uid);
            assert.deepEqual(index.get(nativeHash), entry);
        }
    }
});

test('feature lookup uses native flags even after renaming, and never guesses from a name/source pair', () => {
    const entry = row('classfeatures', 'Second Wind', 'XPHB');
    const doc = document('classfeatures', entry); doc.name = 'My renamed feature';
    assert.deepEqual(describeSource(doc), {type: 'classfeatures', key: featureHashKey('classfeatures', entry.uid)});
    doc.flags.plutonium.hash += ',subhash:value';
    assert.equal(describeSource(doc).key, featureHashKey('classfeatures', entry.uid));
    delete doc.flags.plutonium.hash;
    assert.equal(describeSource(doc), null);
});

test('manual translation and restoring original preserve feature mechanics and unrelated metadata', async () => {
    for (const type of ['classfeatures', 'subclassfeatures', 'optionalfeatures']) {
        const entry = type === 'optionalfeatures' ? row(type, 'Agonizing Blast', 'XPHB') : packs[type].entries.find(e => e.variant);
        const doc = document(type, entry), original = structuredClone({...doc, update: undefined, updateSource: undefined});
        await runTranslationAction(doc, 'translate');
        assert.equal(doc.name, entry.name_uk);
        assert.equal(doc.system.description.value, Object.values(entry.html).join(''));
        assert.deepEqual(doc.system.uses, original.system.uses);
        assert.deepEqual(doc.system.activities, original.system.activities);
        assert.deepEqual(doc.effects, original.effects);
        await runTranslationAction(doc, 'original');
        assert.equal(doc.name, original.name);
        assert.equal(doc.system.description.value, original.system.description.value);
        assert.equal(doc.flags[id].uid, undefined);
        assert.deepEqual(doc.flags[id].customResource, {index: 2});
    }
});

test('translate all includes both feature packs and optional features in one actor update', async () => {
    const items = Object.entries(packs).map(([type, pack]) => document(type, pack.entries[0]));
    const unknown = document('classfeatures', row('classfeatures', 'Second Wind', 'XPHB'));
    unknown.flags.plutonium.hash = 'unknown'; items.push(unknown);
    const writes = [];
    assert.equal(await translateActor({items, updateEmbeddedDocuments: async (...args) => writes.push(args)}), 3);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].length, 3);
});

test('native create hooks translate features with warm and cold caches', async () => {
    const entry = row('classfeatures', 'Second Wind', 'XPHB');
    await refresh();
    const cold = document('classfeatures', entry), options = {};
    hooks.get('preCreateItem')(cold, {}, options);
    assert(options[`${id}.pending`]);
    await hooks.get('createItem')(cold, options, 'gm');
    assert.equal(cold.name, entry.name_uk);
    const warm = document('classfeatures', entry);
    hooks.get('preCreateItem')(warm, {}, {});
    assert.equal(warm.name, entry.name_uk);
});

test('character converter translates class, subclass and optional features on both supported generations', async () => {
    globalThis.DataLoader = {};
    try {
        for (const version of ['5.3.3', '6.0.3']) {
            game.system.version = version;
            for (const [prop, type] of [['classFeature', 'classfeatures'], ['subclassFeature', 'subclassfeatures'], ['optionalfeature', 'optionalfeatures']]) {
                const entry = packs[type].entries[0];
                class Importer { static _DataConverter = {pGetDocumentJson: async () => {
                    const doc = document(type, entry); delete doc.update; delete doc.updateSource; return doc;
                }}; }
                game.plutonium = {importer: {pGetImporter: async () => new Importer()}};
                const adapter = createPlutoniumCharacterAdapter();
                assert.equal((await adapter.convert(prop, {name: entry.name_en}, {})).name, entry.name_uk);
            }
        }
    } finally { delete globalThis.DataLoader; delete game.plutonium; }
});

test('older custom manifests without feature packs leave features untranslated', async () => {
    servedManifest = {...manifest, uk: {optionalfeatures: manifest.uk.optionalfeatures}};
    try {
        await refresh();
        assert.equal(await find('classfeatures', 'second%20wind_fighter_xphb_1_xphb'), null);
    } finally { servedManifest = manifest; await refresh(); }
});
