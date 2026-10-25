// Compatibility audit: real website exports + the installed Plutonium catalogue.
// No Foundry connection, world writes, browser profiles, or simulated claim of live import.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildCharacterPlan, characterImportIssues} from '../scripts/character-plan.js';
import {matchCharacterEntity, createPlutoniumCharacterAdapter} from '../scripts/character-plutonium.js';
import {usesFullSpellList, maximumClassSpellLevel, selectClassSpells} from '../scripts/character-spell-lists.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const plutonium = process.argv[2] ?? path.resolve(root, '../plutonium');
const cache = process.argv[3];
const context = vm.createContext({window: {}, console});
const names = ['cb-data', 'cb-equipment', 'cb-sheet', 'cb-autofill'];
const scripts = await Promise.allSettled(names.map(async name => {
    if (cache) return readFile(path.join(cache, `${name}.js`), 'utf8');
    const response = await fetch(`https://1d20.com.ua/wp-content/plugins/dnd-tools-suite/assets/js/character-builder/${name}.min.js`, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
}));
for (const result of scripts) { if (result.status !== 'fulfilled') throw result.reason; vm.runInContext(result.value, context); }
context.window.MASTER_DATA = cache ? JSON.parse(await readFile(path.join(cache, 'builder-data.json'), 'utf8')) : await (await fetch('https://1d20.com.ua/wp-json/dnd/v1/builder-data')).json();
vm.runInContext(await readFile(path.join(root, 'tools/character-builder-export.js'), 'utf8'), context);
const {CBD: cbd, CBAutofill: fill, D20FoundryExporter: exporter} = context.window;
const catalog = cbd.md();
const json = async file => JSON.parse(await readFile(path.join(plutonium, 'data', file), 'utf8'));
const classIndex = await json('class/index.json');
const classData = await Promise.allSettled(Object.values(classIndex).map(file => json(`class/${file}`)));
const nativeClasses = [], nativeSubclasses = [];
const classFeatures = [], subclassFeatures = [];
for (const result of classData) {
    if (result.status !== 'fulfilled') throw result.reason;
    nativeClasses.push(...result.value.class ?? []);
    nativeSubclasses.push(...result.value.subclass ?? []);
    classFeatures.push(...result.value.classFeature ?? []);
    subclassFeatures.push(...result.value.subclassFeature ?? []);
}
const raceData = await json('races.json');
const races = [...raceData.race, ...raceData.subrace.map(row => ({...row, name: `${row.raceName} (${row.name})`, _baseName: row.raceName, _baseSource: row.raceSource, _subraceName: row.name}))];
const lists = {classes: nativeClasses, subclasses: nativeSubclasses, races, subraces: races, backgrounds: (await json('backgrounds.json')).background, feats: (await json('feats.json')).feat, optionalFeatures: (await json('optionalfeatures.json')).optionalfeature};
const spellIndex = await json('spells/index.json');
lists.spells = [];
for (const result of await Promise.allSettled(Object.values(spellIndex).map(file => json(`spells/${file}`)))) {
    if (result.status !== 'fulfilled') throw result.reason;
    lists.spells.push(...result.value.spell ?? []);
}
// DataUtil.spell attaches these generated class memberships when loading spells.
const spellSources = await json('generated/gendata-spell-source-lookup.json');
for (const spell of lists.spells) {
    const lookup = spellSources[spell.source.toLowerCase()]?.[spell.name.toLowerCase()];
    for (const [from, to] of [['class', 'fromClassList'], ['classVariant', 'fromClassListVariant']]) {
        const entries = [];
        for (const [source, classes] of Object.entries(lookup?.[from] ?? {})) for (const [name, value] of Object.entries(classes)) {
            const defined = value.definedInSources ?? [value.definedInSource];
            entries.push(...defined.map(definedInSource => ({name, source, definedInSource})));
        }
        if (entries.length) { spell.classes ??= {}; spell.classes[to] = [...spell.classes[to] ?? [], ...entries]; }
    }
}
const preparedLists = [];
for (const entity of nativeClasses.filter(usesFullSpellList)) {
    const level = ['Druid', 'Cleric'].includes(entity.name) ? 3 : 5;
    const spells = selectClassSpells(lists.spells, {entity, level});
    const maximum = maximumClassSpellLevel(entity, level);
    assert(spells.length > 0, `${entity.name} ${entity.source}: empty spell list`);
    assert(spells.every(spell => spell.level > 0 && spell.level <= maximum));
    if (entity.name === 'Druid') assert(spells.some(spell => spell.name === 'Moonbeam' && spell.level === 2 && spell.source === entity.source));
    preparedLists.push({class: `${entity.name}|${entity.source}`, level, maximum, spells: spells.length});
}
let builds = 0, spellSelections = 0;
const unresolved = new Set();
function match(type, slug, ref, parent) {
    const entity = matchCharacterEntity(type, slug, ref, lists[type], parent);
    if (!entity) unresolved.add(`${type}: ${slug}`);
    return entity;
}
for (const cls of catalog.classes) for (const level of [1, 5, 11, 20]) {
    const state = cbd.defaultState();
    Object.assign(state, {edition: cls.edition, editionPicked: true, mode: 'expert', classSlug: cls.slug, level,
        raceSlug: cls.edition === '2024' ? 'human-xphb' : 'human-phb', bgSlug: cls.edition === '2024' ? 'soldier-xphb' : 'soldier-phb'});
    fill.fill(state, catalog, {random: false});
    const data = exporter.exportCharacter({state});
    assert.deepEqual(characterImportIssues(data), [], `${cls.slug} L${level}`);
    assert.equal(data.diagnostics.warnings.length, 0, `${cls.slug}: ${JSON.stringify(data.diagnostics.warnings)}`);
    const plan = buildCharacterPlan(data);
    for (const selected of plan.classes) {
        const parent = match('classes', selected.slug, selected.reference);
        if (selected.subclassSlug) match('subclasses', selected.subclassSlug, selected.subclassReference, parent);
    }
    for (const selected of plan.options) match(selected.type, selected.slug, selected.reference);
    for (const slug of plan.feats) match('feats', slug, plan.reference('feats', slug));
    for (const spell of plan.spells) if (spell.slug) { match('spells', spell.slug, spell.reference); spellSelections++; }
    builds++;
}
// Exercise every catalogue identity, not only the first subclass selected by autofill.
for (const type of ['races', 'backgrounds', 'subclasses', 'subraces']) for (const row of catalog[type]) {
    if (row.base) continue;
    const parentKey = row.class_key ?? row.race_key;
    const [name, source] = parentKey?.split('|') ?? [];
    match(type, row.slug, {nameEn: row.name_en ?? row.title_en, source: row.source}, parentKey ? {name, source} : null);
}
// Exercise actual choice-resolution code against native feature records. Conversion
// and Actor preparation are deliberately outside the scope of this catalogue audit.
globalThis.game = {system: {id: 'dnd5e', version: '6.0.3'}, modules: new Map([['plutonium', {active: true}]]), plutonium: {importer: {pGetImporter() { throw new Error('No conversion in catalogue audit'); }}}};
globalThis.DataLoader = {};
globalThis.DataUtil = {class: {loadRawJSON: async () => ({class: nativeClasses, subclass: nativeSubclasses, classFeature: classFeatures, subclassFeature: subclassFeatures})}};
const adapter = createPlutoniumCharacterAdapter();
let choiceChecks = 0;
const unresolvedChoices = [];
for (const row of [...catalog.classes, ...catalog.subclasses]) {
    const isSubclass = !!row.title_en;
    const [parentName, parentSource] = row.class_key.split('|');
    const cls = nativeClasses.find(c => c.name === parentName && c.source === parentSource);
    const sc = isSubclass ? match('subclasses', row.slug, {nameEn: row.title_en, source: row.source}, cls) : null;
    const features = [...classFeatures.filter(f => f.className === parentName && (f.classSource ?? 'PHB') === parentSource),
        ...subclassFeatures.filter(f => f.className === parentName && f.subclassShortName === sc?.shortName && (f.subclassSource ?? f.source) === sc?.source)];
    for (const choice of [...(row.featOpts ?? []).flatMap(slot => slot.options.map(option => ({key: option.key, level: slot.lvl, featureLevel: slot.lvl}))),
        ...(row.featVars ?? []).filter(v => !v.parent).map(v => ({key: v.key, level: v.lvl, featureLevel: v.lvl}))]) {
        try { await adapter.choiceFeature(choice, cls, sc, features); choiceChecks++; }
        catch (error) { unresolvedChoices.push(`${row.slug}: ${choice.key}: ${error.message}`); }
    }
}
delete globalThis.game; delete globalThis.DataLoader; delete globalThis.DataUtil;
console.log(JSON.stringify({builds, classes: catalog.classes.length, levels: [1, 5, 11, 20], spellSelections,
    catalogueIdentities: Object.fromEntries(['races', 'backgrounds', 'subclasses', 'subraces'].map(type => [type, catalog[type].length])), choiceChecks, preparedLists, unresolved: [...unresolved], unresolvedChoices}, null, 2));
if (unresolved.size || unresolvedChoices.length) process.exitCode = 1;
