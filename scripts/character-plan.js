import {MODULE_ID} from './constants.js';
import {parseCharacterExport} from './character-builder.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const SKILLS = {acro: 'acr', anim: 'ani', arc: 'arc', athl: 'ath', dec: 'dec', hist: 'his', ins: 'ins', intim: 'itm', inv: 'inv', med: 'med', nat: 'nat', perc: 'prc', perf: 'prf', pers: 'per', rel: 'rel', sleig: 'slt', ste: 'ste', surv: 'sur'};
export const SKILL_ABILITIES = {acr: 'dex', ani: 'wis', arc: 'int', ath: 'str', dec: 'cha', his: 'int', ins: 'wis', itm: 'cha', inv: 'int', med: 'wis', nat: 'int', prc: 'wis', prf: 'cha', per: 'cha', rel: 'int', slt: 'dex', ste: 'dex', sur: 'wis'};
export const skillAbility = row => ABILITIES.includes(row.stat) ? row.stat : SKILL_ABILITIES[SKILLS[row.id]];
const TOOLS = {"alchemist's supplies": 'alchemist', "brewer's supplies": 'brewer', "calligrapher's supplies": 'calligrapher', "carpenter's tools": 'carpenter', "cartographer's tools": 'cartographer', "cobbler's tools": 'cobbler', "cook's utensils": 'cook', "glassblower's tools": 'glassblower', "jeweler's tools": 'jeweler', "leatherworker's tools": 'leatherworker', "mason's tools": 'mason', "painter's supplies": 'painter', "potter's tools": 'potter', "smith's tools": 'smith', "tinker's tools": 'tinker', "weaver's tools": 'weaver', "woodcarver's tools": 'woodcarver', "thieves' tools": 'thief', "disguise kit": 'disg', "forgery kit": 'forg', "herbalism kit": 'herb', "poisoner's kit": 'pois', "navigator's tools": 'navg', 'dragonchess set': 'chess', 'dice set': 'dice', 'playing card set': 'card', 'playing cards': 'card', 'pan flute': 'panflute', 'vehicles (land)': 'land', 'vehicles (water)': 'water', 'vehicles (air)': 'air', 'vehicles (space)': 'space'};
const LANGUAGES = {'common sign language': 'sign', 'deep speech': 'deep', "thieves' cant": 'cant'};
const ARMOR = {light: 'lgt', medium: 'med', heavy: 'hvy', shield: 'shl', shields: 'shl'};
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const array = value => Array.isArray(value) ? value : [];
export const unique = values => [...new Set(values.filter(value => value != null && value !== ''))];
const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
const keyOf = value => String(value).toLowerCase().split('|')[0].trim();
const values = value => value && typeof value === 'object' ? Object.values(value) : [];
const fixed = entries => array(entries).flatMap(entry => typeof entry === 'string' ? [entry] : Object.entries(entry ?? {}).filter(([key, value]) => value === true && key !== 'choose').map(([key]) => key));

/** Validate the envelope, not a whitelist of builds. Missing choices are reported separately. */
export function characterImportIssues(input) {
    const data = parseCharacterExport(input);
    if (!data) return ['Це не експорт персонажа 1d20.'];
    const {character: c, state: s, snapshot: snap} = data;
    const issues = [];
    if (!['2014', '2024'].includes(String(data.rules.edition))) issues.push('Невідома редакція правил.');
    if (!c.classes.length || c.classes.some(row => !row.slug || !Number.isInteger(row.level) || row.level < 1 || row.level > 20)
        || c.classes.reduce((sum, row) => sum + row.level, 0) !== c.level || c.level > 20
        || new Set(c.classes.map(row => row.slug)).size !== c.classes.length) issues.push('Некоректний список або сума рівнів класів (1–20).');
    if (!c.raceSlug || !c.backgroundSlug) issues.push('Не вибрано расу або передісторію.');
    for (const key of ABILITIES) if (!Number.isInteger(snap.abilities?.final?.[key]) || snap.abilities.final[key] < 1 || snap.abilities.final[key] > 30) issues.push(`Некоректна характеристика ${key}.`);
    if (!Number.isInteger(snap.hitPoints) || snap.hitPoints < 1) issues.push('Не визначено максимум HP.');
    if (!Array.isArray(snap.skillRows) || snap.skillRows.length !== 18 || new Set(snap.skillRows.map(row => SKILLS[row.id])).size !== 18 || snap.skillRows.some(row => !SKILLS[row.id])) issues.push('Неповний перелік навичок.');
    if (!Array.isArray(snap.savingThrowRows) || snap.savingThrowRows.length !== 6 || new Set(snap.savingThrowRows.map(row => row.id)).size !== 6 || snap.savingThrowRows.some(row => !ABILITIES.includes(row.id))) issues.push('Неповний перелік ряткидків.');
    if (!Array.isArray(s.equipment) || s.equipment.some(row => !(row.slug || row.key || row.name) || !Number.isInteger(row.qty) || row.qty < 1)) issues.push('Некоректні кількості або назви спорядження.');
    if (!Number.isInteger(snap.goldNow) || snap.goldNow < 0) issues.push('Некоректна кількість грошей.');
    const path = array(snap.classPathOf);
    if (c.classes.length > 1 && (path.length !== c.level || c.classes.some(row => path.filter(slug => slug === row.slug).length !== row.level))) issues.push('Немає точного порядку рівнів мультикласу. Повторіть експорт.');
    if (c.level > 1 && (array(snap.hpLevels).length !== c.level - 1 || snap.hpLevels.some(row => !Number.isFinite(row.v) || row.v < 1))) issues.push('Немає повної історії HP за рівнями. Повторіть експорт.');
    return issues;
}

export function buildCharacterPlan(input) {
    const data = parseCharacterExport(input);
    const issues = characterImportIssues(data);
    if (issues.length) throw new Error(issues.join('\n'));
    const {state: s, snapshot: snap, character: c} = data;
    const refs = data.references.entities;
    const reference = (type, slug) => refs.find(row => row.type === type && row.slug === slug);
    const primarySlug = snap.classPathOf?.[0] ?? s.classSlug ?? c.classes[0].slug;
    const classes = c.classes.map(row => ({...row, primary: row.slug === primarySlug,
        state: row.slug === primarySlug ? s : array(s.multiclass).find(mc => mc.slug === row.slug) ?? {},
        casting: array(snap.casting).find(view => view.classSlug === row.slug) ?? {},
        reference: reference('classes', row.slug), subclassReference: reference('subclasses', row.subclassSlug)}));
    const feats = unique(array(snap.featSlugsOf));
    const options = [];
    for (const cls of classes) {
        for (const slug of unique(values(cls.casting.classOptions ?? cls.state.classOpts).flat().filter(value => typeof value === 'string'))) {
            const ref = refs.find(row => row.slug === slug && ['feats', 'optionalFeatures'].includes(row.type));
            options.push({slug, type: ref?.type ?? 'optionalFeatures', reference: ref, classSlug: cls.slug});
        }
    }
    const spells = [];
    const addSpell = (row, meta) => {
        if (!row || !(row.slug || row.key || row.uid)) return;
        spells.push({...row, ...meta, reference: reference('spells', row.slug)});
    };
    for (const cls of classes) {
        const cast = cls.casting;
        for (const row of array(cast.selectedSpells ?? cls.state.spells)) addSpell(row, {origin: `class:${cls.slug}`, classSlug: cls.slug, kind: 'class', ability: cast.spellStats?.ability ?? cast.castingAbility});
        for (const row of array(cast.subclassSpellList)) addSpell(row, {origin: `class:${cls.slug}`, classSlug: cls.slug, kind: 'subclass', ability: row.ab ?? cast.spellStats?.ability ?? cast.castingAbility});
        for (const row of array(cast.featSpellList)) addSpell(row, {origin: row.sub ? `class:${cls.slug}` : `feat:${row.src ?? row.from ?? row.group ?? 'unknown'}`, classSlug: cls.slug, kind: row.sub ? 'subclass' : 'feat', ability: row.ab});
        for (const row of array(cast.arcanumList)) addSpell(row, {origin: `arcanum:${cls.slug}`, classSlug: cls.slug, kind: 'arcanum', ability: cast.spellStats?.ability ?? cast.castingAbility});
    }
    // Primary spellsForSheet aggregates multiclass and enriches key-only racial spells.
    const enriched = array(snap.casting?.[0]?.spellsForSheet);
    const racial = array(snap.casting?.[0]?.raceSpellList);
    for (const row of racial) addSpell(row, {origin: `race:${c.subraceSlug || c.raceSlug}`, kind: 'race', ability: row.ab});
    for (const row of spells) if (!row.slug) {
        const candidates = enriched.filter(other => other.slug && (other.key === row.key || (row.name && other.name === row.name)));
        const slugs = unique(candidates.map(other => other.slug));
        if (slugs.length === 1) { row.slug = slugs[0]; row.reference = reference('spells', row.slug); }
    }
    const merged = new Map();
    for (const row of spells) {
        const key = `${row.origin}:${row.slug || row.key || row.uid}`;
        const previous = merged.get(key);
        if (!previous) merged.set(key, row);
        // A class spell granted by its subclass is always prepared, even if selected too.
        else if (row.kind === 'subclass') merged.set(key, {...previous, ...row, prep: true});
    }
    const diagnostics = [
        ...data.diagnostics.incompleteStages.map(row => `Незавершений крок «${row.label ?? row.stage}»: ${array(row.missing).join(' ')}`),
        ...data.diagnostics.warnings.map(row => `${row.path}: ${row.message}`),
        ...data.diagnostics.unresolvedReferences.map(row => `Невідоме посилання експорту: ${row.slug} (${row.path})`)
    ];
    return {data, classes, feats, options, spells: [...merged.values()], reference, diagnostics};
}

export function hitPointAdvancement(data, cls, hitDie) {
    const path = array(data.snapshot.classPathOf).length ? data.snapshot.classPathOf : Array(data.character.level).fill(cls.slug);
    const gains = new Map(array(data.snapshot.hpLevels).map(row => [row.lvl, row.v]));
    const value = {};
    let classLevel = 0;
    path.forEach((slug, index) => {
        if (slug !== cls.slug) return;
        classLevel++;
        value[classLevel] = index === 0 ? 'max' : gains.get(index + 1);
        if (index > 0 && (!Number.isInteger(value[classLevel]) || value[classLevel] > hitDie)) throw new Error(`Некоректний кидок HP на рівні ${index + 1}.`);
    });
    return value;
}

export function characterActorSource(data) {
    const {state: s, snapshot: snap} = data;
    const resolved = snap.resolvedState ?? {};
    const mechanics = snap.mechanics ?? {};
    const grants = array(snap.heroFeatureGrants);
    const races = [resolved.raceData, resolved.subraceData].filter(Boolean);
    const bg = resolved.bgData ?? {};
    const classData = resolved.classData ?? {};
    const languages = unique(mechanics.languages ?? [
        ...(String(data.rules.edition) === '2024' ? ['common'] : []), ...array(s.langs),
        ...races.flatMap(row => fixed(row.languages ?? row.languageProficiencies)), ...fixed(bg.languageProficiencies), ...grants.flatMap(row => array(row.langKeys))
    ]);
    const toolNames = unique(mechanics.tools ?? [
        ...values(s.toolPicks).flat(), ...array(s.multiclass).flatMap(row => values(row.toolPicks).flat()),
        ...races.flatMap(row => fixed(row.tools ?? row.toolProficiencies)), ...fixed(bg.toolProficiencies), ...fixed(classData.startingProficiencies?.tools)
    ]);
    const armor = unique(mechanics.armor ?? [...(classData.armor_keys ?? fixed(classData.startingProficiencies?.armor)), ...races.flatMap(row => array(row.armor_keys)), ...grants.flatMap(row => array(row.armorKeys))]);
    const weapons = unique(mechanics.weapons?.keys ?? [...array(classData.weapon_keys), ...fixed(classData.startingProficiencies?.weapons), ...array(s.raceWeapons), ...array(s.featWeapons)]);
    const coins = snap.goldNow;
    const saves = Object.fromEntries(snap.savingThrowRows.map(row => [row.id, row.prof ? 1 : 0]));
    const biography = [s.biography, s.backstory, s.notes, s.play?.notes].filter(value => typeof value === 'string' && value);
    const selected = structuredClone(s);
    delete selected.portrait;
    for (const key of Object.keys(selected)) if (key.endsWith('Data')) delete selected[key];
    const source = {
        name: data.character.name || 'Без імені', type: 'character', items: [], effects: [],
        system: {
            abilities: Object.fromEntries(ABILITIES.map(key => [key, {value: snap.abilities.final[key], max: snap.abilities.final[key] > 20 ? snap.abilities.final[key] : null, proficient: saves[key]}])),
            // MappingField's per-key initial value applies to missing entries only.
            // Supplying {value} alone makes every existing entry default to DEX in 6.x.
            skills: Object.fromEntries(snap.skillRows.map(row => [SKILLS[row.id], {ability: skillAbility(row), value: row.expert ? 2 : row.prof ? 1 : mechanics.checks?.halfPb ? 0.5 : 0}])),
            tools: Object.fromEntries(toolNames.map(name => [own(TOOLS, keyOf(name)) ?? keyOf(name).replace(/[^a-z0-9]+/g, '-'), {value: array(snap.allExpertise).includes(name) ? 2 : 1}])),
            attributes: {hp: {value: snap.hitPoints, max: null, temp: Number(s.play?.hpTemp) || 0}, movement: {walk: Number(snap.raceSenses?.speed) || 0, units: 'ft'}, senses: {darkvision: Number(snap.raceSenses?.darkvision) || 0, units: 'ft'}},
            traits: {size: ({T: 'tiny', S: 'sm', M: 'med', L: 'lg', H: 'huge', G: 'grg'})[snap.heroSize] ?? 'med',
                languages: {value: languages.map(name => own(LANGUAGES, name) ?? name)},
                dr: {value: unique([...array(snap.raceSenses?.resist), ...grants.flatMap(row => array(row.resist))])},
                di: {value: unique(grants.flatMap(row => array(row.immune)))}, ci: {value: unique(grants.flatMap(row => array(row.condImmune)))},
                weaponProf: {value: weapons.map(key => ({simple: 'sim', martial: 'mar'})[key]).filter(Boolean), mastery: {value: []}},
                armorProf: {value: armor.map(key => ARMOR[key] ?? ARMOR[keyOf(key)]).filter(Boolean)}},
            currency: {pp: 0, gp: Math.floor(coins / 100), ep: 0, sp: Math.floor(coins % 100 / 10), cp: coins % 10},
            details: {alignment: String(s.alignment ?? ''), age: String(s.charAge ?? ''), gender: String(s.gender ?? ''),
                height: String(s.charHeight ?? ''), weight: String(s.charWeight ?? ''),
                biography: {value: `<p>Імпортовано з конструктора 1d20.</p>${biography.map(text => `<p>${escapeHTML(text).replace(/\n/g, '<br>')}</p>`).join('')}`}}
        },
        flags: {[MODULE_ID]: {characterImport: {schemaVersion: 1, characterId: data.character.id ?? null, exportedAt: data.exportedAt ?? null, importedAt: new Date().toISOString(), selections: selected}}}
    };
    // Keep only web images or known raster data URLs from the builder portrait.
    if (typeof s.portrait === 'string' && /^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(s.portrait)) source.img = s.portrait;
    return source;
}

/** Mirror the builder's strongest equipped armour/shield choice; native dnd5e then computes AC. */
export function equipmentLoadout(data) {
    const gear = data.state.equipment;
    const dex = Math.floor((data.snapshot.abilities.final.dex - 10) / 2);
    const caps = {LA: Infinity, MA: 2, HA: 0};
    const armor = gear.map((row, index) => ({row, index})).filter(({row}) => Object.hasOwn(caps, row.data?.at) && row.data.ac)
        .sort((a, b) => (b.row.data.ac + Math.min(dex, caps[b.row.data.at])) - (a.row.data.ac + Math.min(dex, caps[a.row.data.at])))[0];
    const shield = gear.findIndex(row => row.data?.at === 'S');
    return {armor: data.snapshot.mechanics?.ac?.noArmor ? -1 : armor?.index ?? -1, shield};
}
