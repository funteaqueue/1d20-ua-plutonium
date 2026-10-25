import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseCharacterExport, inspectCharacterExport, characterPreviewHTML} from '../scripts/character-builder.js';

const source = await readFile(new URL('../tools/character-builder-export.js', import.meta.url), 'utf8');
const consoleSource = await readFile(new URL('../tools/character-builder-console.js', import.meta.url), 'utf8');

function setup() {
    const state = {
        id: 'fixture', charName: 'Тест', edition: '2024', level: 1,
        raceSlug: 'human-xphb', classSlug: 'wizard-xphb', bgSlug: 'sage-xphb',
        scores: {str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10},
        spells: [{slug: 'shield-xphb', name: 'Щит', level: 1, prep: false}],
        equipment: [{key: 'book|xphb', qty: 2}],
        customFutureField: {selection: 'preserved'}, portrait: 'data:image/png;base64,AA=='
    };
    const catalog = {
        _origin: 'fixture',
        races: [{slug: 'human-xphb', name_en: 'Human', source: 'XPHB'}],
        classes: [{slug: 'wizard-xphb', name_en: 'Wizard', source: 'XPHB'}],
        backgrounds: [{slug: 'sage-xphb', name_en: 'Sage', source: 'XPHB', feats: [{'magic initiate|xphb': true}]}],
        feats: [{slug: 'magic-initiate-xphb', name_en: 'Magic Initiate', source: 'XPHB'}],
        spells: [{slug: 'shield-xphb', name_en: 'Shield', level: 1}],
        equipment: {items: {'book|xphb': {s: 'book-xphb', en: 'Book', n: 'Книга'}}},
        languages: {}, tools: {}, weaponMasteries: {}
    };
    const cbd = {
        BUILDER_VERSION: 'fixture',
        resolveImprovements(s) { s.asiResolved = [{bonus: {int: 2}}]; },
        mcResolveImprovements() {}, enrichSpells() {}, printSnapshot: () => ({}),
        calcFinalScores: s => ({...s.scores, int: s.scores.int + 2}),
        classLevelList: s => [{slug: s.classSlug, level: s.level}],
        charLevelOf: s => s.level, pbOf: () => 2, goldNow: () => 100,
        mcViews: () => [], visibleStages: () => [{k: 'sum', label: 'Підсумок'}], stageMissing: () => []
    };
    for (const key of ['classPathOf', 'allAsiResolved', 'allExpertise', 'allMasteryNames', 'featSlugsOf',
        'heroFeatureGrants', 'heroSlots', 'languageRows', 'toolRows', 'raceTraits', 'raceSenses', 'heroSize', 'hpLevels',
        'spellsForSheet', 'raceSpellList', 'subclassSpellList', 'featSpellList', 'featGrants', 'featPicks', 'arcanumList', 'spellbook']) cbd[key] = () => [];
    const sheet = {};
    for (const key of ['hitPoints', 'hitDice', 'armorClass', 'speed', 'initiative', 'passivePerception',
        'skillRows', 'savingThrowRows', 'proficiencyRows', 'attackRows', 'spellStats']) sheet[key] = () => null;
    const copied = [];
    const window = {CBD: cbd, CBSheet: sheet, MASTER_DATA: {items: [catalog]},
        localStorage: {getItem: key => { assert.equal(key, 'dnd_character_v2'); return JSON.stringify(state); },
            setItem: () => assert.fail('Exporter wrote to storage')},
        navigator: {clipboard: {writeText: async json => copied.push(json)}}};
    const context = vm.createContext({window, navigator: window.navigator, console, copy: json => copied.push(json)});
    vm.runInContext(source, context);
    return {state, catalog, window, context, copied, exporter: window.D20FoundryExporter};
}

test('preserves all input choices, separates base/final scores and never changes source data', () => {
    const {state, catalog, exporter} = setup();
    const before = JSON.stringify({state, catalog});
    const data = exporter.exportCharacter({state});
    assert.equal(JSON.stringify({state, catalog}), before);
    assert.equal(data.state.customFutureField.selection, 'preserved');
    assert.equal(data.state.spells[0].prep, false);
    assert.equal(data.state.equipment[0].qty, 2);
    assert.equal(data.snapshot.abilities.base.int, 15);
    assert.equal(data.snapshot.abilities.final.int, 17);
    assert.equal(data.state.asiResolved, undefined);
    assert.equal(data.diagnostics.warnings.length, 0);
    assert.equal(parseCharacterExport(JSON.stringify(data)).schemaVersion, 1);
});

test('collects transitive UID references and preserves missing spell source instead of guessing', () => {
    const {exporter} = setup();
    const data = exporter.exportCharacter();
    const entities = data.references.entities;
    assert(entities.some(row => row.type === 'feats' && row.slug === 'magic-initiate-xphb'));
    assert.equal(entities.find(row => row.type === 'items').source, 'XPHB');
    assert.equal(entities.find(row => row.type === 'spells').source, null);
    assert.equal(new Set(entities.map(row => `${row.type}:${row.slug}`)).size, entities.length);
});

test('keeps unknown selections and reports unavailable calculations and incomplete stages', () => {
    const {state, window, exporter} = setup();
    state.spells.push({slug: 'custom-spell', name: 'Homebrew'});
    state.classOpts = {invocation: 'custom-invocation'};
    state.featGrantsSnap = [{feat: 'Перекладена назва риси'}];
    delete window.CBSheet.hitPoints;
    window.CBD.stageMissing = () => ['Оберіть мови'];
    const data = exporter.exportCharacter({state});
    assert.equal(data.state.spells.at(-1).slug, 'custom-spell');
    assert(data.diagnostics.unresolvedReferences.some(row => row.slug === 'custom-spell'));
    assert(data.diagnostics.unresolvedReferences.some(row => row.slug === 'custom-invocation'));
    assert(!data.diagnostics.unresolvedReferences.some(row => row.slug === 'Перекладена назва риси'));
    assert(data.diagnostics.warnings.some(row => row.code === 'missing-helper' && row.path === 'snapshot.hitPoints'));
    assert.equal(data.diagnostics.incompleteStages[0].missing[0], 'Оберіть мови');
});

test('portrait opt-out does not remove the original; missing character/catalog fails clearly', () => {
    const {state, window, exporter} = setup();
    assert.equal(exporter.exportCharacter({state, includePortrait: false}).state.portrait, null);
    assert(state.portrait.startsWith('data:'));
    assert.throws(() => exporter.exportCharacter({state: null}), /Немає поточного/);
    window.MASTER_DATA = null;
    assert.throws(() => exporter.exportCharacter({state}), /Каталог/);
});

test('serializes derived Sets and Maps without losing expertise or keyed choices', () => {
    const {window, exporter} = setup();
    window.CBD.allExpertise = () => new Set(['arcana', 'stealth']);
    window.CBD.heroFeatureGrants = () => new Map([['skill', ['arcana']]]);
    const data = JSON.parse(exporter.toJSON());
    assert.deepEqual(data.snapshot.allExpertise, ['arcana', 'stealth']);
    assert.deepEqual(data.snapshot.heroFeatureGrants, [['skill', ['arcana']]]);
});

test('the console command returns exactly the JSON it copies, and uses the same adapter', async () => {
    assert(consoleSource.includes(source));
    const {context, window, copied} = setup();
    const json = await vm.runInContext(consoleSource, context);
    assert.equal(json, copied[0]);
    assert.equal(json, window.d20FoundryJSON);
    assert.equal(inspectCharacterExport(json).name, 'Тест');
});

test('receiver distinguishes links/other JSON, rejects broken or future exports', () => {
    assert.equal(parseCharacterExport('https://1d20.com.ua/spells/shield-xphb/'), null);
    assert.equal(parseCharacterExport('{"format":"other"}'), null);
    assert.throws(() => parseCharacterExport('{"format":"1d20.character",'), /обрізаний/);
    const data = setup().exporter.exportCharacter();
    assert.throws(() => parseCharacterExport({...data, schemaVersion: 2}), /версія/);
    assert.throws(() => parseCharacterExport({...data, references: {entities: [null]}}), /довідник/);
});

test('preview escapes names, slugs and diagnostics rather than interpreting pasted HTML', () => {
    const data = setup().exporter.exportCharacter();
    data.character.name = '<img src=x onerror=alert(1)>';
    data.diagnostics.warnings.push({message: '<script>bad()</script>', path: '<iframe>'});
    const html = characterPreviewHTML(data);
    assert(!html.includes('<img'));
    assert(!html.includes('<script'));
    assert(html.includes('&lt;img'));
    assert(html.includes('До вибору дії аркуш не змінюється'));
});

test('pasting an envelope never sends embedded URLs to the Plutonium importer', async () => {
    const {initPaste} = await import('../scripts/paste.js');
    const data = setup().exporter.exportCharacter();
    data.state.link = 'https://1d20.com.ua/spells/shield-xphb/';
    let listener, dialog, prevented = false;
    globalThis.game = {modules: new Map([['plutonium', {active: true}]]), settings: {get: () => true},
        plutonium: {importer: {pGetImporter: () => assert.fail('Unexpected item import')}}};
    globalThis.Element = class {};
    globalThis.document = {addEventListener: (_event, callback) => { listener = callback; }, querySelectorAll: () => []};
    globalThis.foundry = {applications: {api: {DialogV2: {wait: async options => { dialog = options; }}}}};
    globalThis.ui = {notifications: {error: message => assert.fail(message)}};
    try {
        initPaste();
        listener({target: null, clipboardData: {getData: () => JSON.stringify(data)}, preventDefault: () => { prevented = true; }});
        await new Promise(resolve => setImmediate(resolve));
        assert(prevented);
        assert(dialog.content.includes('Тест'));
        assert.equal(dialog.buttons[0].action, 'close');
    } finally {
        for (const key of ['game', 'Element', 'document', 'foundry', 'ui']) delete globalThis[key];
    }
});

test('the same paste listener handles a 5etools link followed by character JSON', async () => {
    const {initPaste} = await import('../scripts/paste.js');
    const data = setup().exporter.exportCharacter();
    const imported = [], previews = [];
    let listener;
    globalThis.game = {modules: new Map([['plutonium', {active: true}]]), settings: {get: () => true},
        plutonium: {importer: {
            ImportOpts: class { constructor(options) { Object.assign(this, options); } },
            pGetImporter: async ({page}) => ({pImportEntry: async entry => {
                imported.push({page, entry});
                return {doNotification() {}};
            }})
        }}};
    globalThis.Element = class {};
    globalThis.document = {addEventListener: (_event, callback) => { listener = callback; }, querySelectorAll: () => []};
    globalThis.DataLoader = {pCacheAndGetHash: async (page, hash) => ({name: 'Shield', page, hash})};
    globalThis.foundry = {applications: {api: {DialogV2: {wait: async options => { previews.push(options); }}}}};
    globalThis.ui = {notifications: {error: message => assert.fail(message)}};
    const paste = async text => {
        listener({target: null, clipboardData: {getData: () => text}, preventDefault() {}});
        await new Promise(resolve => setImmediate(resolve));
    };
    try {
        initPaste();
        await paste('https://5e.tools/spells.html#shield_xphb');
        assert.equal(imported.length, 1);
        assert.equal(previews.length, 0);
        await paste(JSON.stringify(data));
        assert.equal(imported.length, 1);
        assert.equal(previews.length, 1);
        assert.match(previews[0].content, /Тест/);
    } finally {
        for (const key of ['game', 'Element', 'document', 'DataLoader', 'foundry', 'ui']) delete globalThis[key];
    }
});
