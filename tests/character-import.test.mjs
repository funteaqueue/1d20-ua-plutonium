import test from 'node:test';
import assert from 'node:assert/strict';
import {characterImportIssues, characterActorSource, prepareCharacterImport, canPopulateCharacter, importCharacterExport, repairCharacterSkills} from '../scripts/character-import.js';
import {buildCharacterPlan, hitPointAdvancement} from '../scripts/character-plan.js';
import {matchCharacterEntity} from '../scripts/character-plutonium.js';
import {additionalSpellRules, configureCharacterSpell, characterSpellAbility, findSpellGrant} from '../scripts/character-spells.js';
import {characterSystemMajor, initialCharacterArmor} from '../scripts/character-compat.js';

function fixture() {
    const ids = ['acro', 'anim', 'arc', 'athl', 'dec', 'hist', 'ins', 'intim', 'inv', 'med', 'nat', 'perc', 'perf', 'pers', 'rel', 'sleig', 'ste', 'surv'];
    return {
        format: '1d20.character', schemaVersion: 1, rules: {edition: '2024', system: 'dnd5e'},
        character: {name: 'Test fighter', id: 'test', level: 1, classes: [{slug: 'fighter-xphb', level: 1}], raceSlug: 'dwarf-xphb', backgroundSlug: 'soldier-xphb'},
        state: {classOpts: {'0': 'thrown-weapon-fighting-xphb'}, toolPicks: {bg: ['dragonchess set']}, langs: ['abyssal', 'giant'],
            weaponMastery: ['spear|xphb', 'shortbow|xphb', 'club|xphb'],
            equipment: [{slug: 'spear-xphb', qty: 1}, {slug: 'arrows-20-xphb', qty: 2}, {slug: 'three-dragon-ante-set-xphb', qty: 1}]},
        snapshot: {abilities: {final: {str: 16, dex: 14, con: 14, int: 13, wis: 10, cha: 8}}, hitPoints: 13, armorClass: 12, speed: 30, goldNow: 16900,
            raceSenses: {speed: 30, darkvision: 120, resist: ['poison']}, heroSize: 'M',
            mechanics: {hpBonuses: [{hp: 1}], weapons: {keys: ['simple', 'martial']}, armor: ['light', 'medium', 'heavy', 'shield']},
            skillRows: ids.map(id => ({id, en: id, prof: ['athl', 'hist', 'intim', 'perc'].includes(id), expert: false})),
            savingThrowRows: ['str', 'dex', 'con', 'int', 'wis', 'cha'].map(id => ({id, prof: ['str', 'con'].includes(id)})),
            featSlugsOf: ['savage-attacker-xphb'], casting: [], heroFeatureGrants: []},
        references: {entities: [{type: 'items', slug: 'chain-mail-xphb', nameEn: 'Chain Mail', source: 'XPHB'}]},
        diagnostics: {incompleteStages: [], unresolvedReferences: [], warnings: []}
    };
}

function harness({hpBonus = 0, ac = 12, fail = null} = {}) {
    const calls = [];
    let id = 0;
    return {
        calls,
        randomID: () => `test${String(++id).padStart(12, '0')}`,
        makeActor(source) {
            const system = structuredClone(source.system);
            const classes = source.items.filter(row => row.type === 'class');
            const levels = classes.reduce((sum, row) => sum + row.system.levels, 0) || 1;
            const con = Math.floor((system.abilities.con.value - 10) / 2);
            // Mirror the dnd5e 6 schema default for explicitly supplied skill entries.
            for (const skill of Object.values(system.skills)) {
                skill.ability ??= 'dex';
                skill.total = Math.floor((system.abilities[skill.ability].value - 10) / 2) + Math.floor((2 + Math.floor((levels - 1) / 4)) * skill.value);
            }
            system.attributes.hp.max = classes.reduce((sum, row) => sum + Object.values(row.system.advancement).filter(a => a.type === 'HitPoints').reduce((n, a) => n + Object.values(a.value).reduce((m, gain) => m + Math.max(1, (gain === 'max' ? Number(row.system.hd.denomination.slice(1)) : gain) + con), 0), 0), 0)
                + hpBonus + levels * Number(system.attributes.hp.bonuses?.level || 0) + Number(system.attributes.hp.bonuses?.overall || 0);
            system.attributes.ac = {value: system.attributes.ac?.override ?? (system.attributes.ac?.calc === 'flat' ? system.attributes.ac.flat : ac)};
            return {system};
        },
        adapter: {
            async resolve(type, slug) { calls.push([type, slug]); if (slug === fail) throw new Error('Missing official entity'); return {name: slug, source: 'XPHB', hd: {faces: slug.startsWith('wizard') ? 6 : 10}, level: 1, spellcastingAbility: slug.startsWith('wizard') ? 'int' : 'cha'}; },
            async classFeatures() { return [{name: 'Second Wind'}]; },
            async subclassFeatures() { return [{name: 'Subclass Feature'}]; },
            async choiceFeature(choice) { return {prop: 'classFeature', entity: {name: choice.key}}; },
            raceFeatures() { return [{name: 'Dwarven Toughness'}]; },
            async convert(prop, entity) {
                const type = prop === 'item' ? (entity.name === 'spear-xphb' ? 'weapon' : 'loot') : ['classFeature', 'raceFeature'].includes(prop) ? 'feat' : prop;
                return {name: entity.name, type, effects: [{name: 'Keep native effect'}], flags: {plutonium: {page: prop}}, system: {
                    type: {baseItem: entity.name.replace('-xphb', '')}, hd: {denomination: `d${entity.hd?.faces ?? 10}`}, identifier: entity.name, quantity: entity.name === 'arrows-20-xphb' ? 20 : 1,
                    activities: {native: {type: 'utility'}}, advancement: {scale: {_id: 'scale', type: 'ScaleValue'}}
                }};
            }
        }
    };
}

test('rejects malformed core data before conversion without restricting character combinations', async () => {
    assert.deepEqual(characterImportIssues(fixture()), []);
    for (const mutate of [d => d.character.level = 2, d => d.character.classes[0].level = 21,
        d => d.snapshot.skillRows.pop(), d => d.snapshot.savingThrowRows.pop(), d => d.state.equipment[0].qty = -1]) {
        const data = fixture(); mutate(data);
        const h = harness();
        await assert.rejects(prepareCharacterImport(data, h));
        assert.equal(h.calls.length, 0);
    }
});

test('source maps skill keys, saves, languages, tools and copper to native actor fields', () => {
    const data = fixture();
    data.character.name = '<img src=x onerror=alert(1)>';
    const source = characterActorSource(data);
    assert.equal(source.system.skills.itm.value, 1);
    assert.equal(source.system.skills.prc.value, 1);
    assert.equal(source.system.abilities.con.proficient, 1);
    assert.deepEqual(source.system.currency, {pp: 0, gp: 169, ep: 0, sp: 0, cp: 0});
    assert.deepEqual(source.system.tools, {chess: {value: 1}});
    assert.deepEqual(source.system.traits.languages.value, ['common', 'abyssal', 'giant']);
    assert(!source.system.details.biography.value.includes('<img'));
});

test('custom resources become independent features with self-consuming uses and no guessed recharge', async () => {
    const data = fixture();
    data.state.resources = [{label: ' зяблики ', value: '44'}, {label: '', value: ''}, {label: 'Empty pool', value: 0}];
    data.snapshot.classResources = [{label: 'Second Wind', value: 2}];
    const before = JSON.stringify(data);
    const prepared = await prepareCharacterImport(data, harness());
    assert.equal(JSON.stringify(data), before);
    assert.equal(prepared.counts.customResource, 2);
    const resource = prepared.source.items.find(item => item.name === 'зяблики');
    assert.equal(resource.type, 'feat');
    assert.deepEqual(resource.system.uses, {spent: 0, max: '44', recovery: []});
    const action = Object.values(resource.system.activities)[0];
    assert.equal(action.type, 'utility');
    assert.equal(action.activation.type, '');
    assert.equal(action.consumption.spellSlot, false);
    assert.deepEqual(action.consumption.targets, [{type: 'itemUses', target: '', value: '1', scaling: {mode: ''}}]);
    assert.equal(prepared.source.items.filter(item => item.name === 'Second Wind').length, 1);
    assert.equal(prepared.source.items.find(item => item.name === 'Empty pool').system.uses.max, '0');
});

test('free-text resource values are escaped descriptions rather than executable formulas', async () => {
    const data = fixture();
    data.state.resources = [
        {label: 'Notes', value: '<img src=x onerror=alert(1)>'},
        {label: 'Formula', value: '1d20 + @abilities.wis.mod'},
        {label: 'Missing', value: ''}, {label: '', value: '9'}
    ];
    const prepared = await prepareCharacterImport(data, harness());
    assert.equal(prepared.counts.customResource, 3);
    for (const item of prepared.source.items.filter(item => item.flags?.['1d20-ua-plutonium']?.customResource)) {
        assert.equal(item.system.uses.max, '');
        assert.deepEqual(item.system.activities, {});
        assert(!item.system.description.value.includes('<img'));
    }
    assert(prepared.notes.some(note => note.includes('немає назви')));
    assert(prepared.notes.some(note => note.includes('для лічильника потрібне')));
});

test('all 18 skills carry their own ability and native totals use it with proficiency/expertise', async () => {
    const data = fixture();
    data.snapshot.skillRows.find(row => row.id === 'hist').expert = true;
    const prepared = await prepareCharacterImport(data, harness());
    const skills = prepared.source.system.skills;
    assert.deepEqual(Object.fromEntries(Object.entries(skills).map(([id, skill]) => [id, skill.ability])), {
        acr: 'dex', ani: 'wis', arc: 'int', ath: 'str', dec: 'cha', his: 'int', ins: 'wis', itm: 'cha', inv: 'int',
        med: 'wis', nat: 'int', prc: 'wis', prf: 'cha', per: 'cha', rel: 'int', slt: 'dex', ste: 'dex', sur: 'wis'
    });
    const actor = harness().makeActor(prepared.source);
    assert.equal(actor.system.skills.ath.total, 5); // STR +3, proficiency +2
    assert.equal(actor.system.skills.his.total, 5); // INT +1, expertise +4
    assert.equal(actor.system.skills.itm.total, 1); // CHA -1, proficiency +2
    assert.equal(actor.system.skills.prc.total, 2); // WIS +0, proficiency +2
    assert.equal(actor.system.skills.acr.total, 2); // DEX +2, no proficiency
    data.snapshot.skillRows.find(row => row.id === 'intim').stat = 'str';
    assert.equal(characterActorSource(data).system.skills.itm.ability, 'str');
});

test('preflight detects a changed skill ability and reports differing totals without overriding effects', async () => {
    const data = fixture();
    data.snapshot.skillRows.find(row => row.id === 'arc').mod = 5;
    const prepared = await prepareCharacterImport(data, harness());
    assert(prepared.notes.some(note => note.includes('бонус Foundry 1, конструктор 5')));
    const h = harness(), make = h.makeActor;
    h.makeActor = source => {
        const actor = make(source);
        actor.system.skills.ath.ability = 'dex';
        return actor;
    };
    await assert.rejects(prepareCharacterImport(data, h), /Характеристика athl/);
});

test('preflight accounts for native Jack of All Trades without writing half proficiency into base skills', async () => {
    for (const systemVersion of ['5.3.3', '6.0.3']) {
        const data = fixture(), h = harness(), make = h.makeActor;
        // The site export can omit the bard feature from its calculated checks.
        data.snapshot.mechanics.checks = {halfPb: false};
        data.snapshot.skillRows.find(row => row.id === 'hist').expert = true;
        data.snapshot.skillRows.find(row => row.id === 'anim').mod = 0;
        const effect = {transfer: true, changes: [{key: 'flags.dnd5e.jackOfAllTrades', mode: 5, value: true}]};
        const convert = h.adapter.convert;
        h.adapter.classFeatures = async () => [{name: 'Jack of All Trades'}];
        h.adapter.convert = async (...args) => {
            const item = await convert(...args);
            if (args[1].name === 'Jack of All Trades') item.effects = [structuredClone(effect)];
            return item;
        };
        h.makeActor = source => {
            const actor = make(source);
            const enabled = source.items.some(item => item.effects?.some(e => e.transfer && e.changes?.some(c => c.key === 'flags.dnd5e.jackOfAllTrades' && c.value)));
            actor.system.calculateAbilityCheckProficiency = (base, ability, options) => {
                assert(source.system.skills[options.skill]);
                assert.equal(source.system.skills[options.skill].ability, ability);
                return {multiplier: enabled && base < 1 ? 0.5 : base};
            };
            for (const skill of Object.values(actor.system.skills)) if (enabled && skill.value < 1) {
                skill.value = 0.5;
                skill.total += 1;
            }
            return actor;
        };
        const out = await prepareCharacterImport(data, {...h, systemVersion});
        assert.equal(out.source.system.skills.ani.value, 0);
        assert.equal(out.source.system.skills.ath.value, 1);
        assert.equal(out.source.system.skills.his.value, 2);
        assert.equal(h.makeActor(out.source).system.skills.ani.value, 0.5);
        assert(out.notes.some(note => note.includes('бонус Foundry 1, конструктор 0')));
        assert.deepEqual(out.source.items.find(item => item.name === 'Jack of All Trades').effects, [effect]);
    }
});

test('preflight still rejects unexplained proficiency changes and lost expertise', async () => {
    for (const [key, value] of [['ani', 0.5], ['ath', 0], ['his', 1]]) {
        const data = fixture(), h = harness(), make = h.makeActor;
        data.snapshot.skillRows.find(row => row.id === 'hist').expert = true;
        h.makeActor = source => {
            const actor = make(source);
            actor.system.calculateAbilityCheckProficiency = base => ({multiplier: base});
            actor.system.skills[key].value = value;
            return actor;
        };
        await assert.rejects(prepareCharacterImport(data, h), /Володіння/);
    }
});

test('legacy repair changes only abilities of a single owned all-DEX import', async () => {
    const source = characterActorSource(fixture());
    for (const skill of Object.values(source.system.skills)) skill.ability = 'dex';
    const writes = [];
    const actor = {id: 'legacy', name: 'Legacy', type: 'character', isOwner: true, flags: source.flags,
        toObject: () => structuredClone(source), update: async update => writes.push(update)};
    globalThis.ui = {notifications: {info() {}}, windows: {legacy: {rendered: true, actor}}};
    globalThis.foundry = {applications: {instances: new Map([['same-sheet', {rendered: true, actor}]])}};
    try {
        assert.equal(await repairCharacterSkills(), actor);
        assert.equal(writes.length, 1);
        assert.equal(Object.keys(writes[0]).length, 15);
        assert.equal(writes[0]['system.skills.ath.ability'], 'str');
        assert.equal(writes[0]['system.skills.prc.ability'], 'wis');
        assert(Object.keys(writes[0]).every(key => /^system\.skills\.\w+\.ability$/.test(key)));
        source.system.skills.arc.ability = 'int';
        await assert.rejects(repairCharacterSkills(actor), /немає помилки/);
        actor.isOwner = false;
        await assert.rejects(repairCharacterSkills(actor), /власний персонаж/);
        actor.isOwner = true;
        ui.windows.second = {rendered: true, actor: {...actor, id: 'second'}};
        await assert.rejects(repairCharacterSkills(), /лише один/);
        assert.equal(writes.length, 1);
    } finally { delete globalThis.ui; delete globalThis.foundry; }
});

test('preparation imports selected inventory only, handles packs and preserves native activities/effects', async () => {
    const data = fixture();
    const before = JSON.stringify(data);
    const prepared = await prepareCharacterImport(data, harness());
    const {source} = prepared;
    assert.equal(JSON.stringify(data), before);
    assert(!source.items.some(item => item.name === 'chain-mail-xphb'));
    assert(!source.items.some(item => item.name === 'club-xphb')); // mastery is not inventory
    assert.equal(source.items.find(item => item.name === 'arrows-20-xphb').system.quantity, 40);
    assert.equal(source.items.find(item => item.name === 'spear-xphb').system.equipped, true);
    assert(source.items.every(item => item.effects.length === 1 && item.system.activities.native));
    assert.deepEqual(source.system.traits.weaponProf.mastery.value, ['spear', 'shortbow', 'club']);
    assert.equal(source.system.attributes.hp.bonuses.level, '1');
    const cls = source.items.find(item => item.type === 'class');
    assert.deepEqual(Object.values(cls.system.advancement).find(a => a.type === 'HitPoints').value, {'1': 'max'});
    assert(cls.system.advancement.scale);
    assert.equal(source.system.details.originalClass, cls._id);
});

test('new imports expand druid spell lists while preserving preparation on both system generations', async () => {
    for (const systemVersion of ['5.3.3', '6.0.0']) {
        const data = fixture(), h = harness(), resolve = h.adapter.resolve;
        data.character.level = 3;
        data.character.classes = [{slug: 'druid-xphb', level: 3}];
        data.snapshot.classPathOf = Array(3).fill('druid-xphb');
        data.snapshot.hpLevels = [{lvl: 2, v: 5}, {lvl: 3, v: 5}];
        data.snapshot.hitPoints = 27;
        data.snapshot.mechanics.hpBonuses = [{hp: 3}];
        data.snapshot.casting = [{classSlug: 'druid-xphb', selectedSpells: [{slug: 'cure-wounds-xphb', prep: true}], spellStats: {ability: 'wis'}}];
        h.adapter.resolve = async (type, slug, ...args) => type === 'classes' && slug === 'druid-xphb'
            ? {name: 'Druid', source: 'XPHB', hd: {faces: 8}, spellcastingAbility: 'wis', classTableGroups: [{rowsSpellProgression: [[2], [3], [4, 2]]}]}
            : resolve(type, slug, ...args);
        h.adapter.classSpellList = async cls => {
            assert.equal(cls.level, 3);
            return [{name: 'Cure Wounds', source: 'XPHB', level: 1}, {name: 'Moonbeam', source: 'XPHB', level: 2}];
        };
        const out = await prepareCharacterImport(data, {...h, systemVersion});
        const spells = out.source.items.filter(item => item.type === 'spell');
        assert.equal(spells.length, 2);
        assert.equal(spells.find(item => item.name === 'cure-wounds-xphb').system.prepared, 1);
        assert.equal(spells.find(item => item.name === 'Moonbeam').system.prepared, 0);
        assert(spells.every(item => item.system.ability === 'wis' && item.system.sourceItem === 'class:Druid'));
    }
});

test('portrait data never enters actor preparation or the core character source', async () => {
    for (const portrait of ['data:image/png;base64,AA==', 'https://example.com/portrait.png', 'data:image/png;base64,broken!']) {
        const data = fixture(), h = harness(), make = h.makeActor;
        data.state.portrait = portrait;
        h.makeActor = source => { assert.equal(source.img, undefined); return make(source); };
        const out = await prepareCharacterImport(data, h);
        assert.equal(out.portrait, portrait);
        assert.equal(out.source.img, undefined);
        assert.equal(out.source.flags['1d20-ua-plutonium'].characterImport.selections.portrait, undefined);
    }
});

test('native HP bonus is not counted twice and necessary adjustments are reported', async () => {
    const prepared = await prepareCharacterImport(fixture(), harness({hpBonus: 1}));
    assert.equal(prepared.source.system.attributes.hp.bonuses, undefined);
    const adjusted = await prepareCharacterImport(fixture(), harness({ac: 13, hpBonus: 2}));
    assert.equal(adjusted.source.system.attributes.ac.override, 12);
    assert(adjusted.notes.some(note => note.startsWith('КО')));
    assert.equal(adjusted.source.system.attributes.hp.bonuses.overall, '-1');
    await assert.rejects(prepareCharacterImport(fixture(), harness({fail: 'savage-attacker-xphb'})), /Missing official entity/);
});

test('Foundry 13 / dnd5e 5.3 uses native flat AC and the shared spell, uses and advancement schemas', async () => {
    const data = fixture();
    data.state.resources = [{label: 'Custom', value: '44'}];
    data.snapshot.casting = [{classSlug: 'fighter-xphb', selectedSpells: [{slug: 'shield-xphb', prep: true}], spellStats: {ability: 'int'}}];
    const out = await prepareCharacterImport(data, {...harness({ac: 13}), systemVersion: '5.3.3'});
    assert.deepEqual(out.source.system.attributes.ac, {calc: 'flat', flat: 12});
    const spell = out.source.items.find(row => row.name === 'shield-xphb');
    assert.equal(spell.system.method, 'spell');
    assert.equal(spell.system.ability, 'int');
    assert.equal(spell.system.prepared, 1);
    assert.equal(out.source.items.find(row => row.name === 'Custom').system.uses.max, '44');
    assert.deepEqual(Object.values(out.source.items.find(row => row.type === 'class').system.advancement).find(row => row.type === 'HitPoints').value, {'1': 'max'});
    assert.deepEqual(initialCharacterArmor(5, ['Monk'], false), {calc: 'unarmoredMonk'});
    assert.deepEqual(initialCharacterArmor(5, ['Monk'], true), {calc: 'default'});
    assert.deepEqual(initialCharacterArmor(6, ['Monk'], false), {calcs: ['unarmored', 'armored', 'unarmoredMonk']});
    assert.equal(characterSystemMajor('5.3.0'), 5);
    for (const version of ['5.2.0', '4.4.0', '7.0.0']) assert.throws(() => characterSystemMajor(version), /Імпорт потребує/);
});

test('commit is a single write; failures, occupied sheets and concurrent edits leave target intact', async () => {
    const writes = [];
    const actor = {id: 'target', type: 'character', isOwner: true, isToken: false, items: new Map(), effects: new Map(), flags: {},
        toObject: () => ({name: 'Empty'}), importFromJSON: async json => { writes.push(JSON.parse(json)); return actor; }, sheet: {render: async () => {}}};
    globalThis.game = {user: {can: () => true}};
    globalThis.ui = {notifications: {info() {}}};
    globalThis.CONFIG = {Actor: {documentClass: {create: async source => { writes.push(source); return actor; }}}};
    try {
        assert(canPopulateCharacter(actor));
        await assert.rejects(importCharacterExport(fixture(), {actor, prepare: async () => { throw new Error('Preflight'); }}), /Preflight/);
        assert.equal(writes.length, 0);
        await assert.rejects(importCharacterExport(fixture(), {actor, review: false, prepare: async () => {
            actor.items.set('new', {});
            return {source: {}, name: 'Test'};
        }}), /Аркуш змінився/);
        assert.equal(writes.length, 0);
        assert(!canPopulateCharacter(actor));
        actor.items.clear();
        await importCharacterExport(fixture(), {actor, review: false, prepare: (data, options) => prepareCharacterImport(data, {...harness(), ...options})});
        assert.equal(writes.length, 1);
        assert.equal(writes[0]._id, 'target');
        actor.flags = writes[0].flags;
        await assert.rejects(importCharacterExport(fixture(), {actor}), /порожній аркуш/);
        assert.equal(writes.length, 1);
    } finally {
        delete globalThis.game; delete globalThis.ui; delete globalThis.CONFIG;
    }
});

test('simultaneous imports cannot race to create duplicate characters', async () => {
    globalThis.game = {user: {can: () => true}};
    globalThis.ui = {notifications: {info() {}}};
    let release;
    const first = importCharacterExport(fixture(), {prepare: () => new Promise((resolve, reject) => { release = () => reject(new Error('Test complete')); })});
    try {
        await assert.rejects(importCharacterExport(fixture()), /вже триває/);
        release();
        await assert.rejects(first, /Test complete/);
    } finally { delete globalThis.game; delete globalThis.ui; }
});

test('multiclass preserves chronological HP, subclass, slots and separate copies of spells', async () => {
    const data = fixture();
    data.character.level = 5;
    data.character.classes = [{slug: 'fighter-xphb', level: 2, primary: true}, {slug: 'wizard-xphb', level: 3, subclassSlug: 'wizard-xphb-abjurer-xphb', primary: false}];
    data.state.classSlug = 'fighter-xphb';
    data.state.multiclass = [{slug: 'wizard-xphb', spells: [{slug: 'shield-xphb', prep: false}]}];
    data.snapshot.classPathOf = ['fighter-xphb', 'wizard-xphb', 'fighter-xphb', 'wizard-xphb', 'wizard-xphb'];
    data.snapshot.hpLevels = [{lvl: 2, v: 4}, {lvl: 3, v: 6}, {lvl: 4, v: 3}, {lvl: 5, v: 4}];
    data.snapshot.hitPoints = 42;
    data.snapshot.mechanics.hpBonuses = [{hp: 5}];
    data.snapshot.heroSlots = {slots: [4, 2, 0, 0, 0, 0, 0, 0, 0], slotCount: 0};
    data.snapshot.casting = [
        {classSlug: 'fighter-xphb', selectedSpells: [{slug: 'shield-xphb', prep: true}], spellStats: {ability: 'cha'}},
        {classSlug: 'wizard-xphb', selectedSpells: [{slug: 'shield-xphb', prep: false}, {slug: 'magic-missile-xphb', prep: true}], spellStats: {ability: 'int'}}
    ];
    assert.deepEqual(characterImportIssues(data), []);
    assert.deepEqual(hitPointAdvancement(data, data.character.classes[0], 10), {'1': 'max', '2': 6});
    assert.deepEqual(hitPointAdvancement(data, data.character.classes[1], 6), {'1': 4, '2': 3, '3': 4});
    const out = await prepareCharacterImport(data, harness());
    assert.equal(out.counts.class, 2);
    assert.equal(out.counts.subclass, 1);
    assert.equal(out.counts.spell, 3);
    const shields = out.source.items.filter(row => row.name === 'shield-xphb');
    assert.deepEqual(shields.map(row => [row.system.ability, row.system.prepared]), [['cha', 1], ['int', 0]]);
    assert.equal(out.source.system.spells.spell2.override, 2);
    assert.equal(out.source.items.find(row => row.name === 'wizard-xphb').system.levels, 3);
});

test('2014 race, subrace, background, feature choices and custom items have no profile gate', async () => {
    const data = fixture();
    data.rules.edition = '2014';
    data.character.raceSlug = 'elf-phb';
    data.character.subraceSlug = 'elf-phb-high-phb';
    data.character.backgroundSlug = 'sage-phb';
    data.character.classes[0] = {slug: 'cleric-phb', level: 1};
    data.state.classOpts = {};
    data.state.featOpts = {'Divine Order': 'Protector'};
    data.state.featVars = {'Harness Divine Power': true};
    data.state.equipment.push({name: '<script>custom</script>', qty: 1});
    data.snapshot.featSlugsOf = [];
    data.snapshot.raceSenses = {speed: 30, darkvision: 60, resist: []};
    data.snapshot.mechanics = {languages: ['common', 'elvish', 'deep speech'], tools: [], weapons: {keys: []}, armor: []};
    data.state.play = {hpCur: 3, hpTemp: 2, notes: 'Keep <safe> notes'};
    const out = await prepareCharacterImport(data, harness());
    assert(out.source.items.some(row => row.name === 'elf-phb-high-phb'));
    assert(out.source.items.some(row => row.name === 'Protector'));
    assert(out.source.items.some(row => row.name === 'Harness Divine Power'));
    assert.equal(out.counts.customItem, 1);
    assert.deepEqual(out.source.system.traits.languages.value, ['common', 'elvish', 'deep']);
    assert.deepEqual(out.source.system.traits.dr.value, []);
    assert.equal(out.source.system.attributes.senses.darkvision, 60);
    assert.equal(out.source.system.attributes.hp.value, 3);
    assert(out.source.system.details.biography.value.includes('&lt;safe&gt;'));
});

test('subclass and subrace identity requires parent and source; ambiguous matches fail', () => {
    const a = {name: 'Hunter', source: 'PHB', className: 'Ranger', classSource: 'PHB'};
    const b = {...a, className: 'Fighter'};
    assert.equal(matchCharacterEntity('subclasses', 'ranger-phb-hunter-phb', {nameEn: 'Hunter', source: 'PHB'}, [a, b], {name: 'Ranger', source: 'PHB'}), a);
    assert.throws(() => matchCharacterEntity('subclasses', 'hunter', {nameEn: 'Hunter', source: 'PHB'}, [a, {...a}], {name: 'Ranger', source: 'PHB'}), /Неоднозначна/);
    const elf = {name: 'Elf (High)', source: 'PHB', _baseName: 'Elf', _baseSource: 'PHB', _subraceName: 'High'};
    assert.equal(matchCharacterEntity('subraces', 'elf-phb-high-phb', {nameEn: 'High', source: 'PHB'}, [elf], {name: 'Elf', source: 'PHB'}), elf);
    assert.equal(matchCharacterEntity('spells', 'shield-xphb', null, [{name: 'Shield', source: 'PHB'}]), null);
});

test('innate spells retain ability, uses and recharge separately, matching Plutonium', async () => {
    const rules = additionalSpellRules({additionalSpells: [{ability: 'cha', known: {'1': ['thaumaturgy#c']}, innate: {'3': {daily: {'1': ['hellish rebuke#2', 'darkness']}}}}]});
    assert.equal(rules.find(rule => rule.name === 'hellish rebuke').castAt, 2);
    assert.equal(rules.find(rule => rule.name === 'thaumaturgy').source, 'phb');
    const pools = new Map(), report = [];
    const first = {_id: 'first', system: {activities: {cast: {type: 'save'}}}};
    const second = {_id: 'second', system: {activities: {cast: {type: 'save'}}}};
    const grant = {...rules.find(rule => rule.name === 'hellish rebuke'), owner: {item: {_id: 'race', system: {identifier: 'tiefling'}}}};
    for (const item of [first, second]) await configureCharacterSpell(item, {origin: 'race:tiefling', kind: 'race'}, {name: 'Hellish Rebuke', level: 1}, {grant, pools, report, chooseAbility: () => assert.fail('Fixed CHA should not prompt')});
    assert.equal(first.system.ability, 'cha');
    assert.equal(first.system.uses.max, '1');
    assert.equal(first.system.uses.recovery[0].period, 'lr');
    assert.equal(second.system.activities.cast.consumption.targets[0].target, '');
    assert.equal(second.system.uses.max, '1');
    assert.equal(second.system.activities.cast.consumption.spellSlot, false);
    assert(report.some(note => note.includes('2-му')));
});

test('mystic arcanum and pact spell slots remain independent of ordinary slots', async () => {
    const data = fixture();
    data.character.classes = [{slug: 'warlock-phb', level: 1}];
    data.snapshot.casting = [{classSlug: 'warlock-phb', selectedSpells: [{slug: 'hex-phb', prep: true}], arcanumList: [{slug: 'disintegrate-phb', level: 6}], spellStats: {ability: 'cha'}}];
    data.snapshot.heroSlots = {slots: [2, 0, 0, 0, 0, 0, 0, 0, 0], slotCount: 1, pactLevel: 1};
    const h = harness();
    const original = h.adapter.resolve;
    h.adapter.resolve = async (...args) => ({...await original(...args), ...(args[1] === 'warlock-phb' ? {casterProgression: 'pact'} : {})});
    const out = await prepareCharacterImport(data, h);
    assert.equal(out.source.items.find(row => row.name === 'hex-phb').system.method, 'pact');
    const arcanum = out.source.items.find(row => row.name === 'disintegrate-phb');
    assert.equal(arcanum.system.uses.max, '1');
    assert.equal(arcanum.system.method, 'innate');
    assert.equal(out.source.system.spells.spell1.value, 2);
    assert.equal(out.source.system.spells.pact.value, 1);
});

test('aggregated spell display rows do not duplicate selected multiclass spells', () => {
    const data = fixture();
    data.state.spells = [{slug: 'shield-xphb'}];
    data.snapshot.casting = [{classSlug: 'fighter-xphb', spellsForSheet: [{slug: 'shield-xphb'}, {slug: 'shield-xphb', src: 'Wizard'}]}];
    assert.equal(buildCharacterPlan(data).spells.length, 1);
});

test('canceling the prepared report writes nothing', async () => {
    let writes = 0;
    globalThis.game = {user: {can: () => true}};
    globalThis.ui = {notifications: {info() {}}};
    globalThis.foundry = {applications: {api: {DialogV2: {wait: async options => { assert(options.content.includes('Аркуш ще не змінено')); return 'cancel'; }}}}};
    globalThis.CONFIG = {Actor: {documentClass: {create: () => writes++}}};
    try {
        assert.equal(await importCharacterExport(fixture(), {prepare: async () => ({source: {}, name: 'Review', itemCount: 0, counts: {}, notes: []})}), null);
        assert.equal(writes, 0);
    } finally { for (const key of ['game', 'ui', 'foundry', 'CONFIG']) delete globalThis[key]; }
});

test('spell resource links and proficiency-based uses preserve native resource semantics', async () => {
    const rules = additionalSpellRules({additionalSpells: [{ability: 'wis', resourceName: 'Ki', innate: {'3': {resource: {'2': ['darkness']}, daily: {pb: ['shield']}}}}]});
    const item = {system: {activities: {cast: {consumption: {spellSlot: true}}}}};
    const owner = {item: {type: 'feat', system: {identifier: 'shadow-arts'}}};
    await configureCharacterSpell(item, {kind: 'feat', origin: 'feat:shadow-arts'}, {name: 'Darkness', level: 2}, {
        grant: {...rules.find(rule => rule.name === 'darkness'), owner}, report: [],
        resourceItems: [{entity: {name: 'Ki'}, item: {_id: 'ki-id', system: {uses: {max: '@classes.monk.levels'}}}}]
    });
    assert.equal(item.system.sourceItem, 'feat:shadow-arts');
    assert.equal(item.system.activities.cast.consumption.spellSlot, false);
    assert.deepEqual(item.system.activities.cast.consumption.targets.map(row => [row.target, row.value]), [['ki-id', '2']]);
    await configureCharacterSpell(item, {kind: 'feat', origin: 'feat:shield'}, {name: 'Shield', level: 1}, {grant: {...rules.find(rule => rule.name === 'shield'), owner}, report: []});
    assert.equal(item.system.uses.max, '@attributes.prof');
    assert.equal(item.system.uses.recovery[0].period, 'lr');
});

test('missing spell ability requires a valid explicit choice and lineage filters grants', async () => {
    const grant = {ability: {choose: ['int', 'wis']}};
    assert.equal(await characterSpellAbility({origin: 'race:test'}, null, grant, async () => 'wis'), 'wis');
    await assert.rejects(characterSpellAbility({origin: 'race:test'}, null, grant, async () => 'cha'), /Не вибрано/);
    const owners = [{prop: 'race', entity: {additionalSpells: [
        {name: 'First', ability: 'int', innate: {'1': {daily: {'1': ['shield']}}}},
        {name: 'Second', ability: 'wis', innate: {'1': {daily: {'2': ['shield']}}}}
    ]}}];
    const row = {kind: 'race', origin: 'race:test'}, spell = {name: 'Shield', source: 'PHB', level: 1};
    assert.throws(() => findSpellGrant(row, spell, owners, 1), /Неоднозначні/);
    assert.equal(findSpellGrant(row, spell, owners, 1, {name_en: 'Second'}).uses, 2);
    const entity = {name: 'Dhampir', source: 'VRGR', otherSources: [{source: 'ABH'}]};
    assert.equal(matchCharacterEntity('races', 'dhampir-abh', null, [entity]), entity);
    assert.equal(matchCharacterEntity('races', 'dhampir-xphb', null, [entity]), null);
});
