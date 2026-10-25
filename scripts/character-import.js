import {MODULE_ID} from './constants.js';
import {slugFor} from './data.js';
import {buildCharacterPlan, characterImportIssues, characterActorSource, hitPointAdvancement, equipmentLoadout, ABILITIES, SKILLS, SKILL_ABILITIES, skillAbility, array, unique, escapeHTML} from './character-plan.js';
import {createPlutoniumCharacterAdapter} from './character-plutonium.js';
import {additionalSpellRules, findSpellGrant, configureCharacterSpell, characterSpellAbility} from './character-spells.js';
import {customResourceFeatures} from './character-resources.js';
import {characterSystemMajor, initialCharacterArmor, overrideCharacterArmor} from './character-compat.js';
import {expandClassSpellLists} from './character-spell-lists.js';
export {characterImportIssues, characterActorSource, createPlutoniumCharacterAdapter};

export function canPopulateCharacter(actor) {
    return !!actor && actor.type === 'character' && actor.isOwner && !actor.isToken
        && actor.items.size === 0 && actor.effects.size === 0 && !actor.flags?.[MODULE_ID]?.characterImport;
}

const noChoice = async ({label, choices}) => { throw new Error(`В експорті не вказано характеристику заклять «${label}». Потрібно обрати: ${choices.join(', ')}. Вставте JSON через Ctrl+V, щоб зробити вибір.`); };
const clone = value => structuredClone(value);
const number = value => typeof value === 'number' && Number.isFinite(value);

/** Build everything in memory. Only the separate commit function writes to the world. */
export async function prepareCharacterImport(input, {adapter, makeActor = source => new CONFIG.Actor.documentClass(source), randomID = () => foundry.utils.randomID(), actorId = null, chooseAbility = noChoice, systemVersion = globalThis.game?.system?.version ?? '6.0.0'} = {}) {
    const plan = buildCharacterPlan(input);
    const systemMajor = characterSystemMajor(systemVersion);
    adapter ??= createPlutoniumCharacterAdapter();
    const {data, classes, reference} = plan;
    const source = characterActorSource(data);
    source._id = actorId ?? randomID();
    const notes = [...plan.diagnostics], owners = [], counts = {}, featureIds = new Map();
    const customResources = customResourceFeatures(data.state, {randomID, notes});
    source.items.push(...customResources);
    if (customResources.length) {
        counts.customResource = customResources.length;
        notes.push('Власні ресурси додано як здібності. Число з конструктора задає повний запас використань; відновлення після відпочинку можна налаштувати у Foundry.');
    }
    const resolved = new Map();
    const resolve = async (type, slug, parent) => {
        const key = `${type}:${slug}`;
        if (!resolved.has(key)) {
            const entity = await adapter.resolve(type, slug, reference(type, slug), parent);
            const requestedSource = reference(type, slug)?.source;
            if (requestedSource && entity.source !== requestedSource && entity.otherSources?.some(row => row.source === requestedSource)) notes.push(`${entity.name}: Plutonium зберігає запис під ${entity.source}; ${requestedSource} вказано як інше видання цього самого запису.`);
            resolved.set(key, entity);
        }
        return clone(resolved.get(key));
    };
    const add = async (prop, entity, options = {}) => {
        const item = await adapter.convert(prop, entity, makeActor(source), options);
        item._id ||= randomID();
        delete item.folder; delete item.ownership;
        source.items.push(item);
        counts[prop] = (counts[prop] ?? 0) + 1;
        owners.push({prop, entity, item, classSlug: options.classSlug, slug: options.slug});
        return item;
    };
    const addFeature = async (prop, entity, options) => {
        const key = JSON.stringify([prop, entity.name, entity.source, entity.className, entity.classSource, entity.subclassShortName, entity.level]);
        if (featureIds.has(key)) return featureIds.get(key);
        const item = await add(prop, entity, options);
        featureIds.set(key, item);
        return item;
    };
    for (const cls of classes) {
        cls.entity = await resolve('classes', cls.slug);
        cls.item = await add('class', cls.entity, {level: cls.level, proficiencyImportMode: cls.primary ? 1 : 0, classSlug: cls.slug});
        cls.item.system.levels = cls.level;
        if (cls.primary) source.system.details.originalClass = cls.item._id;
        const advancement = cls.item.system.advancement ??= {};
        if (Array.isArray(advancement)) throw new Error('Очікується формат advancement dnd5e 5.3/6.x.');
        const hp = Object.values(advancement).find(row => row.type === 'HitPoints');
        const value = hitPointAdvancement(data, cls, cls.entity.hd?.faces ?? Number(cls.item.system.hd?.denomination?.slice(1)));
        if (hp) hp.value = value;
        else { const id = randomID(); advancement[id] = {_id: id, type: 'HitPoints', configuration: {}, value}; }
        if (cls.subclassSlug) {
            cls.subclass = await resolve('subclasses', cls.subclassSlug, cls.entity);
            await add('subclass', cls.subclass, {parentClass: cls.entity, level: cls.level, classSlug: cls.slug});
        }
    }
    // dnd5e 6 keeps a set of available AC formulas and selects the best applicable
    // one as armour/shields change. calc/formula are derived legacy fields.
    source.system.attributes.ac = initialCharacterArmor(systemMajor, classes.map(cls => cls.entity.name), equipmentLoadout(data).armor >= 0);
    let race = await resolve('races', data.character.raceSlug);
    if (data.character.subraceSlug) race = await resolve('subraces', data.character.subraceSlug, race);
    const raceItem = await add('race', race, {slug: data.character.subraceSlug ?? data.character.raceSlug});
    const bg = await resolve('backgrounds', data.character.backgroundSlug);
    const bgItem = await add('background', bg, {slug: data.character.backgroundSlug});
    source.system.details.race = raceItem._id;
    source.system.details.background = bgItem._id;
    if (race.speed && typeof race.speed === 'object') for (const key of ['fly', 'swim', 'climb', 'burrow']) {
        if (number(race.speed[key])) source.system.attributes.movement[key] = race.speed[key];
        else if (race.speed[key] === true) source.system.attributes.movement[key] = source.system.attributes.movement.walk;
    }
    for (const [field, prop] of [['di', 'immune'], ['dv', 'vulnerable'], ['ci', 'conditionImmune']]) {
        const fixed = array(race[prop]).filter(value => typeof value === 'string');
        if (fixed.length) source.system.traits[field] = {value: unique([...array(source.system.traits[field]?.value), ...fixed])};
    }
    const allFeats = new Map(plan.feats.map(slug => [slug, {slug, type: 'feats'}]));
    for (const option of plan.options) allFeats.set(option.slug, option);
    for (const option of allFeats.values()) await add(option.type === 'feats' ? 'feat' : 'optionalfeature', await resolve(option.type, option.slug), {slug: option.slug, classSlug: option.classSlug});
    for (const cls of classes) {
        const features = await adapter.classFeatures(cls.entity, cls.level);
        const subFeatures = cls.subclass ? await adapter.subclassFeatures(cls.subclass, cls.level) : [];
        for (const feature of features) await addFeature('classFeature', feature, {classSlug: cls.slug});
        for (const feature of subFeatures) await addFeature('subclassFeature', feature, {classSlug: cls.slug});
        const choices = array(cls.casting.featureOptions).filter(row => row.chosen).map(row => ({key: row.chosen, level: cls.level, featureLevel: row.lvl}));
        choices.push(...array(cls.casting.featureVariants).filter(row => row.on).map(row => ({key: row.key, level: cls.level, featureLevel: row.lvl})));
        if (!cls.casting.featureOptions) choices.push(...Object.entries(cls.state.featOpts ?? {}).filter(([, value]) => typeof value === 'string').map(([slot, key]) => ({key, level: cls.level, featureLevel: Number(/:(\d+)\|/.exec(slot)?.[1]) || undefined})));
        if (!cls.casting.featureVariants) choices.push(...Object.entries(cls.state.featVars ?? {}).filter(([, enabled]) => enabled).map(([key]) => ({key, level: cls.level, featureLevel: cls.reference?.data?.featVars?.find(row => row.key === key)?.lvl})));
        for (const choice of choices) {
            const selected = await adapter.choiceFeature(choice, cls.entity, cls.subclass, [...features, ...subFeatures]);
            await addFeature(selected.prop, selected.entity, {classSlug: cls.slug});
        }
    }
    for (const feature of adapter.raceFeatures(race)) await addFeature('raceFeature', feature);
    const lineage = data.snapshot.mechanics?.lineage ?? data.snapshot.resolvedState?.raceData?.lineage?.options?.find(row => row.key === data.state.raceLineage);
    if (lineage) {
        raceItem.system.description ??= {};
        raceItem.system.description.value = (raceItem.system.description.value ?? '') + `<p><strong>Вибір 1d20:</strong> ${escapeHTML(lineage.trait ?? lineage.name)}</p>`;
    }
    if (data.state.subraceVariant != null) notes.push(`Варіант підраси: ${data.state.subraceVariant}. Вибір збережено; перевірте умовні ефекти в описі раси.`);
    const loadout = equipmentLoadout(data);
    for (const [index, selected] of data.state.equipment.entries()) {
        if (!selected.slug && !selected.key) {
            source.items.push({_id: randomID(), name: selected.name, type: 'loot', system: {quantity: selected.qty, description: {value: `<p>${escapeHTML(selected.description ?? selected.note ?? 'Власний предмет із конструктора 1d20.')}</p>`}}});
            counts.customItem = (counts.customItem ?? 0) + 1;
            continue;
        }
        const [name, book] = String(selected.key ?? '').split('|');
        const slug = selected.slug || (book ? slugFor(name, book) : null);
        if (!slug) throw new Error(`Немає джерела предмета «${selected.name}».`);
        const item = await add('item', await resolve('items', slug));
        item.system.quantity = (Number(item.system.quantity) || 1) * selected.qty;
        item.system.equipped = typeof selected.equipped === 'boolean' ? selected.equipped : item.type === 'weapon' || index === loadout.armor || index === loadout.shield;
    }
    const weaponKeys = data.snapshot.mechanics?.weapons?.keys ?? [...array(data.snapshot.resolvedState?.classData?.weapon_keys), ...array(data.state.raceWeapons), ...array(data.state.featWeapons)];
    const masteries = unique([...array(data.state.weaponMastery), ...classes.flatMap(cls => array(cls.casting.weaponMastery ?? cls.state.weaponMastery))]);
    for (const [kind, keys] of [['proficiency', weaponKeys.filter(key => key.startsWith('item:'))], ['mastery', masteries]]) {
        for (const value of keys) {
            const [name, book] = value.replace(/^item:/, '').split('|');
            let slug = book ? slugFor(name, book) : null;
            if (!slug) {
                const matches = data.references.entities.filter(row => row.type === 'items' && row.nameEn?.toLowerCase() === name.toLowerCase());
                const editionBook = String(data.rules.edition) === '2024' ? 'XPHB' : 'PHB';
                const exact = matches.filter(row => row.source === editionBook);
                slug = (exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null)?.slug;
                // Standard weapon proficiency identities are stable across PHB/XPHB.
                slug ??= slugFor(name, editionBook);
            }
            const entity = await resolve('items', slug);
            const item = await adapter.convert('item', entity, makeActor(source));
            const base = item.system.type?.baseItem;
            if (!base) throw new Error(`Не визначено тип зброї: ${value}.`);
            (kind === 'mastery' ? source.system.traits.weaponProf.mastery.value : source.system.traits.weaponProf.value).push(base);
        }
    }
    const abilityChoices = new Map();
    const choose = async request => {
        if (!abilityChoices.has(request.key)) abilityChoices.set(request.key, await chooseAbility(request));
        return abilityChoices.get(request.key);
    };
    const spells = await expandClassSpellLists(classes, plan.spells, adapter, notes, (slug, entity) => resolved.set(`spells:${slug}`, clone(entity)));
    for (const row of spells) {
        const cls = classes.find(entry => entry.slug === row.classSlug);
        let slug = row.slug;
        if (!slug) {
            const [name, book] = String(row.uid ?? row.key).split('|');
            if (book) slug = slugFor(name, book);
            else {
                const rules = owners.filter(owner => row.kind !== 'race' || owner.prop === 'race').flatMap(owner => additionalSpellRules(owner.entity)).filter(rule => rule.name === name.toLowerCase());
                const identities = unique(rules.map(rule => slugFor(rule.name, rule.source)));
                if (identities.length === 1) slug = identities[0];
            }
        }
        if (!slug) throw new Error(`Не визначено книгу закляття «${row.name ?? row.key}» (${row.origin}). Повторіть експорт новою командою.`);
        const spell = await resolve('spells', slug);
        const grant = findSpellGrant(row, spell, owners, ['race', 'feat'].includes(row.kind) ? data.character.level : cls?.level ?? data.character.level, lineage);
        row.ability = await characterSpellAbility(row, cls, grant, choose);
        const item = await add('spell', spell, {spellcastingAbilityAbv: row.ability, classSlug: row.classSlug,
            parentClassName: cls?.entity.name, parentClassSource: cls?.entity.source,
            parentSubclassName: cls?.subclass?.name, parentSubclassSource: cls?.subclass?.source,
            castAtLevel: grant?.castAt,
            stateInitial: {method: grant?.method ?? (row.kind === 'arcanum' ? 'innate' : cls?.entity.casterProgression === 'pact' ? 'pact' : 'spell'),
                prepared: grant?.prepared ?? (row.prep === false ? 0 : 1),
                activity: {attack: {attackAbility: row.ability}, save: {saveDcCalculation: row.ability}}}});
        await configureCharacterSpell(item, row, spell, {cls, grant, chooseAbility: choose, report: notes, resourceItems: owners});
    }
    const slots = data.snapshot.heroSlots;
    if (slots?.slots) {
        source.system.spells ??= {};
        for (const [index, max] of slots.slots.entries()) source.system.spells[`spell${index + 1}`] = {value: max, override: max};
    }
    if (slots?.slotCount) {
        source.system.spells ??= {};
        source.system.spells.pact = {value: slots.slotCount, override: slots.slotCount};
    }
    // Adjust a base only when conversion adds an already-counted effect, then recheck.
    let actor = makeActor(source);
    for (const key of ABILITIES) {
        const delta = data.snapshot.abilities.final[key] - actor.system.abilities[key].value;
        if (delta) source.system.abilities[key].value += delta;
    }
    actor = makeActor(source);
    const hpDelta = data.snapshot.hitPoints - actor.system.attributes.hp.max;
    if (hpDelta) {
        const bonus = array(data.snapshot.mechanics?.hpBonuses).reduce((sum, row) => sum + Number(row.hp || 0), 0);
        source.system.attributes.hp.bonuses = hpDelta === bonus && Number.isInteger(bonus / data.character.level)
            ? {level: String(bonus / data.character.level)} : {overall: String(hpDelta)};
        if (hpDelta !== bonus) notes.push(`HP: додано поправку ${hpDelta} до підсумку конструктора. Після зміни рівня перевірте її.`);
    }
    if (number(data.snapshot.speed) && actor.system.attributes.movement.walk !== data.snapshot.speed) {
        const base = source.system.attributes.movement.walk + data.snapshot.speed - actor.system.attributes.movement.walk;
        if (base >= 0) source.system.attributes.movement.walk = base;
    }
    actor = makeActor(source);
    if (number(data.snapshot.armorClass) && actor.system.attributes.ac.value !== data.snapshot.armorClass) {
        if (systemMajor === 6) {
            const rules = data.snapshot.mechanics?.ac;
            source.system.attributes.ac.formulas = array(rules?.formulas).filter(rule => number(rule.base)).map(rule => ({
                label: '1d20', armored: false,
                formula: [String(rule.base), rule.dex ? '@abilities.dex.mod' : null, ABILITIES.includes(rule.add) ? `@abilities.${rule.add}.mod` : null, number(rules.bonus) ? String(rules.bonus) : null].filter(Boolean).join(' + ')
            }));
            if (number(rules?.armorBonus) && rules.armorBonus) source.system.attributes.ac.formulas.push({label: '1d20', armored: true, formula: `@attributes.ac.armor + @attributes.ac.clamped.dex + ${rules.armorBonus + (Number(rules.bonus) || 0)}`});
            actor = makeActor(source);
        }
        if (actor.system.attributes.ac.value !== data.snapshot.armorClass) {
            overrideCharacterArmor(source.system.attributes.ac, data.snapshot.armorClass, systemMajor);
            notes.push(`КО ${data.snapshot.armorClass} перенесено як явне значення конструктора: автообчислення Foundry відрізнялося. Після зміни спорядження перевірте це перевизначення.`);
        }
    }
    const hpCur = data.state.play?.hpCur;
    if (number(hpCur)) source.system.attributes.hp.value = Math.max(0, Math.min(hpCur, data.snapshot.hitPoints));
    const mismatches = [];
    actor = makeActor(source);
    const check = (label, actual, expected) => { if (actual !== expected) mismatches.push(`${label}: Foundry ${actual}, конструктор ${expected}`); };
    check('HP', actor.system.attributes.hp.max, data.snapshot.hitPoints);
    for (const key of ABILITIES) check(key, actor.system.abilities[key].value, data.snapshot.abilities.final[key]);
    if (number(data.snapshot.armorClass)) check('КО', actor.system.attributes.ac.value, data.snapshot.armorClass);
    if (number(data.snapshot.speed)) check('Швидкість', actor.system.attributes.movement.walk, data.snapshot.speed);
    for (const row of data.snapshot.skillRows) {
        const skill = actor.system.skills[SKILLS[row.id]];
        check(`Характеристика ${row.en}`, skill.ability, skillAbility(row));
        check(`Володіння ${row.en}`, skill.value, source.system.skills[SKILLS[row.id]].value);
        if (number(row.mod) && number(skill.total) && skill.total !== row.mod) notes.push(`Навичка ${row.name ?? row.en}: бонус Foundry ${skill.total}, конструктор ${row.mod}. Перевірте додаткові ефекти здібностей; бонус не перевизначено.`);
    }
    if (mismatches.length) throw new Error(`Перевірка аркуша не пройшла. Нічого не записано.\n${mismatches.join('\n')}`);
    notes.push('Дії та ефекти збережено з Plutonium. Автоматизація конкретних правил залежить від його даних і модулів світу.');
    notes.push('Вибори advancement для подальшого підвищення рівня потребують перевірки; початкові вибори конструктора збережені в прапорцях персонажа.');
    notes.push('Комірки й ліміти застосувань починають із повного запасу. Поточні HP і нотатки перенесено.');
    source.flags[MODULE_ID].characterImport.report = {counts, notes: unique(notes), abilityChoices: Object.fromEntries(abilityChoices)};
    return {source, name: source.name, itemCount: source.items.length, counts, notes: unique(notes)};
}

async function selectSpellAbility({label, choices}) {
    const content = `<p>Конструктор не передав характеристику накладання заклять для «${escapeHTML(label)}». Оберіть її один раз для цього джерела.</p><select name="ability">${choices.map(key => `<option value="${key}">${escapeHTML(CONFIG.DND5E.abilities[key]?.label ?? key)}</option>`).join('')}</select>`;
    const result = await foundry.applications.api.DialogV2.wait({window: {title: '1d20: характеристика заклять'}, content,
        buttons: [{action: 'choose', label: 'Застосувати', callback: (_event, button) => button.form.elements.ability.value}, {action: 'cancel', label: 'Скасувати'}], rejectClose: false});
    if (!choices.includes(result)) throw new Error('Імпорт скасовано. Аркуш не змінено.');
    return result;
}

export function characterImportReportHTML(prepared) {
    const labels = {class: 'Класи', subclass: 'Підкласи', race: 'Раса / підраса', background: 'Передісторія', feat: 'Риси', optionalfeature: 'Вибрані опції', classFeature: 'Класові здібності', subclassFeature: 'Здібності підкласу', raceFeature: 'Расові здібності', spell: 'Закляття', item: 'Спорядження', customItem: 'Власні предмети', customResource: 'Власні ресурси'};
    return `<p><strong>${escapeHTML(prepared.name)}</strong>: підготовлено ${prepared.itemCount} записів. Аркуш ще не змінено.</p><ul>${Object.entries(prepared.counts ?? {}).map(([key, value]) => `<li>${escapeHTML(labels[key] ?? key)}: ${value}</li>`).join('')}</ul><p><strong>Звіт перевірки:</strong></p><ul>${array(prepared.notes).map(note => `<li>${escapeHTML(note)}</li>`).join('')}</ul>`;
}

let importing = false;

/** Repair only the known legacy all-DEX import; never replace items or proficiency. */
export async function repairCharacterSkills(actor) {
    if (!actor) {
        const controlled = globalThis.canvas?.tokens?.controlled ?? [];
        const instances = globalThis.foundry?.applications?.instances;
        const apps = [...Object.values(globalThis.ui?.windows ?? {}), ...(instances?.values ? instances.values() : [])];
        const candidates = controlled.length ? controlled.map(token => token.actor) : apps.filter(app => app.rendered).map(app => app.actor);
        const uniqueActors = [...new Map(candidates.filter(a => a?.type === 'character' && a.flags?.[MODULE_ID]?.characterImport).map(a => [a.uuid ?? a.id, a])).values()];
        if (uniqueActors.length !== 1) throw new Error('Відкрийте лише один імпортований чарник або виділіть токен потрібного персонажа. Також можна передати Actor у builder.repairSkills(actor).');
        actor = uniqueActors[0];
    }
    if (!actor.isOwner || actor.type !== 'character' || !actor.flags?.[MODULE_ID]?.characterImport) throw new Error('Потрібен власний персонаж, імпортований із конструктора 1d20.');
    const skills = actor.toObject().system.skills;
    if (!Object.keys(SKILL_ABILITIES).every(key => skills[key]?.ability === 'dex')) throw new Error('У цього персонажа немає помилки «усі навички DEX». Автоматичне виправлення не застосовано.');
    const update = Object.fromEntries(Object.entries(SKILL_ABILITIES).filter(([key, ability]) => skills[key].ability !== ability).map(([key, ability]) => [`system.skills.${key}.ability`, ability]));
    await actor.update(update);
    ui.notifications.info(`1d20: характеристики навичок «${actor.name}» виправлено.`);
    return actor;
}

export async function importCharacterExport(input, {actor = null, prepare = prepareCharacterImport, review = true} = {}) {
    if (importing) throw new Error('Імпорт персонажа вже триває.');
    if (actor && !canPopulateCharacter(actor)) throw new Error('Вставляння доступне лише у власний порожній аркуш без предметів та ефектів. Можна створити нового персонажа.');
    if (!actor && !game.user.can('ACTOR_CREATE')) throw new Error('Немає дозволу створювати персонажів. Відкрийте свій порожній аркуш.');
    importing = true;
    try {
        ui.notifications.info('1d20: збираю та перевіряю персонажа через Plutonium…');
        const initial = actor ? JSON.stringify(actor.toObject()) : null;
        const prepared = await prepare(input, {actorId: actor?.id, chooseAbility: selectSpellAbility});
        if (review) {
            const target = actor ? `Буде заповнено порожній аркуш «${escapeHTML(actor.name)}»: його характеристики, гроші та біографію буде замінено.` : 'Буде створено нового персонажа.';
            const action = await foundry.applications.api.DialogV2.wait({window: {title: '1d20 → Foundry: результат підготовки'}, position: {width: 720}, content: `<p>${target}</p>${characterImportReportHTML(prepared)}`,
                buttons: [{action: 'apply', label: actor ? 'Заповнити аркуш' : 'Створити персонажа'}, {action: 'cancel', label: 'Скасувати', default: true}], rejectClose: false});
            if (action !== 'apply') return null;
        }
        if (actor && (!canPopulateCharacter(actor) || JSON.stringify(actor.toObject()) !== initial)) throw new Error('Аркуш змінився під час підготовки. Повторіть вставляння.');
        const result = actor ? await actor.importFromJSON(JSON.stringify(prepared.source)) : await CONFIG.Actor.documentClass.create(prepared.source, {renderSheet: false, keepId: true});
        if (!result) throw new Error('Foundry скасував збереження персонажа.');
        await result.sheet.render(true);
        ui.notifications.info(`1d20: ${prepared.name} — імпортовано ${prepared.itemCount} записів.`);
        return result;
    } finally { importing = false; }
}
