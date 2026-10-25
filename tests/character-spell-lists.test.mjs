import test from 'node:test';
import assert from 'node:assert/strict';
import {usesFullSpellList, maximumClassSpellLevel, selectClassSpells, expandClassSpellLists} from '../scripts/character-spell-lists.js';
import {completeCharacterSpellLists} from '../scripts/character-spell-completion.js';

const full = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3]];
const entity = (name = 'Druid', source = 'XPHB', rows = full) => ({name, source, spellcastingAbility: name === 'Wizard' ? 'int' : 'wis', classTableGroups: [{rowsSpellProgression: rows}]});
const druid = () => ({entity: entity(), level: 3, slug: 'druid-xphb', state: {}});
const spell = (name, level, source = 'XPHB', nameClass = 'Druid', sourceClass = 'XPHB') => ({name, level, source, classes: {fromClassList: [{name: nameClass, source: sourceClass}]}});

test('full-list policies distinguish books, spellbooks, known casters and ranger editions', () => {
    for (const name of ['Druid', 'Cleric', 'Paladin']) for (const source of ['PHB', 'XPHB']) assert(usesFullSpellList(entity(name, source)));
    for (const source of ['TCE', 'ERLW', 'EFA']) assert(usesFullSpellList(entity('Artificer', source)));
    assert(usesFullSpellList(entity('Ranger', 'XPHB')));
    for (const name of ['Wizard', 'Bard', 'Sorcerer', 'Warlock', 'Ranger']) assert(!usesFullSpellList(entity(name, 'PHB')));
    for (const name of ['Wizard', 'Bard', 'Sorcerer', 'Warlock']) assert(!usesFullSpellList(entity(name, 'XPHB')));
    assert(!usesFullSpellList(entity('Druid', 'UnknownHomebrew')));
});

test('individual class levels bound spell access, including half-caster starting levels', () => {
    assert.equal(maximumClassSpellLevel(entity(), 3), 2);
    assert.equal(maximumClassSpellLevel(entity('Paladin', 'PHB', [[0], [2], [3], [3], [4, 2]]), 1), 0);
    assert.equal(maximumClassSpellLevel(entity('Paladin', 'XPHB', [[2], [2], [3], [3], [4, 2]]), 1), 1);
    assert.equal(maximumClassSpellLevel(entity('Artificer', 'TCE', [[2], [2], [3], [3], [4, 2]]), 5), 2);
    assert.throws(() => maximumClassSpellLevel({name: 'Druid', source: 'XPHB'}, 3), /таблиці/);
});

test('class filtering excludes cantrips, higher circles, wrong edition and unchosen optional expansions', () => {
    const cls = druid();
    const extra = {...spell('Absorb Elements', 1, 'XGE'), classes: {fromClassListVariant: [{name: 'Druid', source: 'XPHB', definedInSource: 'XGE'}]}};
    const optional = {...spell('Optional spell', 2, 'PHB'), classes: {fromClassListVariant: [{name: 'Druid', source: 'XPHB', definedInSource: 'TCE'}]}};
    const all = [spell('Moonbeam', 2), spell('Guidance', 0), spell('Call Lightning', 3), spell('Moonbeam', 2, 'PHB', 'Druid', 'PHB'), spell('Shield', 1, 'XPHB', 'Wizard'), extra, optional];
    assert.deepEqual(selectClassSpells(all, cls).map(s => s.name), ['Moonbeam', 'Absorb Elements']);
    cls.state.featVars = {'Additional Druid Spells': true};
    assert(selectClassSpells(all, cls).some(s => s.name === 'Optional spell'));
});

test('expansion preserves preparations, always-prepared selections and per-class duplicate identities', async () => {
    const selected = [
        {key: 'Cure Wounds|XPHB', classSlug: 'druid-xphb', kind: 'class', prep: true},
        {slug: 'moonbeam-xphb', classSlug: 'druid-xphb', kind: 'subclass', prep: true},
        {slug: 'fog-cloud-xphb', classSlug: 'wizard-xphb', kind: 'class', prep: true}
    ];
    const before = JSON.stringify(selected);
    const rows = await expandClassSpellLists([druid()], selected, {classSpellList: async () => [spell('Cure Wounds', 1), spell('Moonbeam', 2), spell('Fog Cloud', 1), spell('Fog Cloud', 1)]}, []);
    assert.equal(rows.length, 4);
    assert.equal(rows[3].slug, 'fog-cloud-xphb');
    assert.equal(rows[3].prep, false);
    assert.equal(rows[3].classSlug, 'druid-xphb');
    assert.equal(rows[3].ability, 'wis');
    assert.equal(JSON.stringify(selected), before);
});

function completionFixture() {
    let counter = 0;
    const source = {name: 'Multiclass', type: 'character', system: {spells: {spell5: {value: 1}}}, items: [
        {_id: 'druid', type: 'class', system: {identifier: 'druid', levels: 3}, flags: {plutonium: {hash: 'druid_xphb'}}},
        {_id: 'wizard', type: 'class', system: {identifier: 'wizard', levels: 6}, flags: {plutonium: {hash: 'wizard_xphb'}}},
        {_id: 'prepared', type: 'spell', system: {sourceItem: 'class:druid', prepared: 1, uses: {spent: 1}}, flags: {plutonium: {hash: 'cure%20wounds_xphb'}}},
        {_id: 'wizardSpell', type: 'spell', system: {sourceItem: 'class:wizard', prepared: 0}, flags: {plutonium: {hash: 'moonbeam_xphb'}}}
    ]};
    const writes = [];
    const actor = {name: source.name, type: 'character', isOwner: true, items: source.items,
        toObject: () => structuredClone(source), async createEmbeddedDocuments(type, items) { writes.push({type, items}); source.items.push(...items); return items; }};
    const options = {review: false, randomID: () => `test${String(++counter).padStart(12, '0')}`, makeActor: source => ({source}), adapter: {
        async importedClass(item) { return entity(item._id === 'druid' ? 'Druid' : 'Wizard'); },
        async classSpellList(cls) { return selectClassSpells([spell('Cure Wounds', 1), spell('Moonbeam', 2), spell('Call Lightning', 3), spell('Guidance', 0)], cls); },
        async convert(prop, spell) { return {name: spell.name, type: prop, system: {level: spell.level, activities: {}}, flags: {plutonium: {hash: `${encodeURIComponent(spell.name.toLowerCase())}_xphb`}}}; }
    }};
    return {actor, source, writes, options};
}

test('completion adds only missing druid spells and can be repeated without touching existing spells', async () => {
    globalThis.ui = {notifications: {info() {}}};
    const {actor, source, writes, options} = completionFixture();
    const original = JSON.stringify(source.items);
    assert.equal(await completeCharacterSpellLists(actor, options), 1);
    assert.equal(writes[0].items[0].name, 'Moonbeam');
    assert.equal(writes[0].items[0].system.prepared, 0);
    assert.equal(writes[0].items[0].system.sourceItem, 'class:druid');
    assert.equal(writes[0].items[0].system.ability, 'wis');
    assert.equal(JSON.stringify(source.items.slice(0, 4)), original);
    assert.equal(await completeCharacterSpellLists(actor, options), 0);
    assert.equal(writes.length, 1);
    delete globalThis.ui;
});

test('completion cancellation, failed conversion and concurrent edits write no items', async () => {
    globalThis.ui = {notifications: {info() {}}};
    globalThis.foundry = {applications: {api: {DialogV2: {wait: async () => 'cancel'}}}};
    try {
        let fixture = completionFixture();
        assert.equal(await completeCharacterSpellLists(fixture.actor, {...fixture.options, review: true}), 0);
        assert.equal(fixture.writes.length, 0);
        fixture.options.adapter.convert = async () => { throw new Error('Conversion failed'); };
        await assert.rejects(completeCharacterSpellLists(fixture.actor, fixture.options), /Conversion failed/);
        assert.equal(fixture.writes.length, 0);
        fixture = completionFixture();
        const original = fixture.options.adapter.convert;
        fixture.options.adapter.convert = async (...args) => { fixture.source.name = 'Changed'; return original(...args); };
        await assert.rejects(completeCharacterSpellLists(fixture.actor, fixture.options), /Аркуш змінився/);
        assert.equal(fixture.writes.length, 0);
    } finally { delete globalThis.ui; delete globalThis.foundry; }
});
