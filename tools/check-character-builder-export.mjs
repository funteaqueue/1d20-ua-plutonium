// Optional compatibility smoke test against today's public site runtime.
// Downloads code into an isolated VM; never reads a browser profile or edits a hero.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseCharacterExport} from '../scripts/character-builder.js';

const base = 'https://1d20.com.ua/wp-content/plugins/dnd-tools-suite/assets/js/character-builder/';
const urls = ['cb-data', 'cb-equipment', 'cb-sheet'].map(name => `${base}${name}.min.js`);
urls.push('https://1d20.com.ua/wp-json/dnd/v1/builder-data');
const responses = await Promise.allSettled(urls.map(async url => {
    const response = await fetch(url, {signal: AbortSignal.timeout(30_000)});
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
}));
for (const result of responses) if (result.status !== 'fulfilled') throw result.reason;
const context = vm.createContext({window: {}, console});
for (const result of responses.slice(0, 3)) vm.runInContext(result.value, context, {timeout: 5000});
context.window.MASTER_DATA = JSON.parse(responses[3].value);
vm.runInContext(await readFile(new URL('./character-builder-export.js', import.meta.url), 'utf8'), context, {timeout: 5000});
const {CBD: cbd, CBEquip: gear, D20FoundryExporter: exporter} = context.window;
const catalog = cbd.md();
const catalogBefore = JSON.stringify(catalog);

for (const spec of [
    {name: '2014 fighter', edition: '2014', cls: 'fighter-phb', race: 'human-phb', bg: 'soldier-phb', level: 1},
    {name: '2024 wizard', edition: '2024', cls: 'wizard-xphb', race: 'elf-xphb', bg: 'sage-xphb', level: 4, spell: 'shield-xphb'},
    {name: '2014 warlock', edition: '2014', cls: 'warlock-phb', race: 'tiefling-phb', bg: 'sage-phb', level: 11, spell: 'eldritch-blast-phb'},
    {name: '2024 multiclass', edition: '2024', cls: 'fighter-xphb', race: 'human-xphb', bg: 'soldier-xphb', level: 5, mc: 'wizard-xphb'}
]) {
    const state = cbd.defaultState();
    Object.assign(state, {charName: spec.name, edition: spec.edition, editionPicked: true, mode: 'expert',
        classSlug: spec.cls, raceSlug: spec.race, bgSlug: spec.bg, level: spec.level,
        scores: {str: 15, dex: 14, con: 13, int: 15, wis: 12, cha: 13},
        bgPlus2: 'int', bgPlus1: 'con', skills: ['arcana', 'investigation'],
        expertise: ['arcana'], toolPicks: {}, langs: ['elvish'],
        resources: [{label: 'Custom resource', value: '2/3'}],
        play: {hpCur: 3, hpTemp: 2, notes: 'Keep these notes'},
        unknownFutureOption: {keep: true}});
    state.raceData = catalog.races.find(row => row.slug === spec.race);
    state.classData = catalog.classes.find(row => row.slug === spec.cls);
    state.bgData = catalog.backgrounds.find(row => row.slug === spec.bg);
    assert(state.raceData && state.classData && state.bgData, `Missing fixture definitions: ${spec.name}`);
    if (spec.level >= 3) state.subclassSlug = catalog.subclasses.find(row => row.class_key === state.classData.class_key)?.slug;
    const improvement = cbd.improvementSlots(state)[0];
    if (improvement) state.asi[improvement.key] = {kind: 'asi', mode: '2', a: 'int'};
    const sword = gear.fromCatalog(catalog.equipment, spec.edition === '2014' ? 'longsword|phb' : 'longsword|xphb');
    assert(sword);
    state.equipment = [{...sword, qty: 2}, {name: 'Custom keepsake', qty: 1, src: 'custom'}];
    if (spec.spell) {
        const spell = catalog.spells.find(row => row.slug === spec.spell);
        assert(spell);
        state.spells = [{slug: spell.slug, name: spell.name, level: spell.level, prep: false}];
    }
    if (spec.cls === 'warlock-phb') state.arcanum = {6: {slug: 'disintegrate-phb', name: 'Розпад', level: 6}};
    if (spec.mc) cbd.mcCreateAdd(state, catalog, spec.mc);

    // Recreate the site's persisted (rather than hydrated) state before export.
    for (const key of ['raceData', 'subraceData', 'classData', 'subclassData', 'bgData']) delete state[key];
    const before = JSON.stringify(state);
    const payload = exporter.exportCharacter({state});
    parseCharacterExport(JSON.stringify(payload));
    assert.equal(JSON.stringify(state), before, 'Export mutated source state');
    assert.equal(JSON.stringify(catalog), catalogBefore, 'Export mutated site catalogue');
    assert.equal(payload.diagnostics.warnings.length, 0, JSON.stringify(payload.diagnostics.warnings));
    assert.equal(payload.diagnostics.unresolvedReferences.length, 0, JSON.stringify(payload.diagnostics.unresolvedReferences));
    assert.equal(payload.state.unknownFutureOption.keep, true);
    assert.equal(payload.state.play.hpCur, 3);
    assert.equal(payload.state.equipment[0].qty, 2);
    assert.equal(payload.character.level, spec.level + (spec.mc ? 1 : 0));
    assert.equal(payload.character.classes.length, spec.mc ? 2 : 1);
    assert.equal(JSON.stringify(payload.snapshot.abilities.final), JSON.stringify(cbd.calcFinalScores(payload.snapshot.resolvedState)));
    assert(Array.isArray(payload.snapshot.allExpertise), 'Expertise Set was not serialized');
    assert.equal(JSON.stringify(payload.snapshot.allExpertise), JSON.stringify([...cbd.allExpertise(payload.snapshot.resolvedState)]));
    if (spec.spell) assert.equal(payload.state.spells[0].prep, false);
    if (spec.mc) assert(payload.snapshot.casting.some(row => row.classSlug === spec.mc));
    console.log(`${spec.name}: OK, ${JSON.stringify(payload).length} chars, ${payload.references.entities.length} references, ${payload.diagnostics.incompleteStages.length} unfinished stages (deliberate draft fixtures)`);
}
