import {slugFor} from './data.js';

const lower = value => String(value ?? '').toLowerCase();
const SOURCES = {Cleric: ['PHB', 'XPHB'], Druid: ['PHB', 'XPHB'], Paladin: ['PHB', 'XPHB'],
    Artificer: ['TCE', 'ERLW', 'EFA'], Ranger: ['XPHB']};

export function usesFullSpellList(entity) {
    return SOURCES[entity?.name]?.includes(entity.source) ?? false;
}

/** Read the individual class's slot table, never the multiclass actor's slots. */
export function maximumClassSpellLevel(entity, level) {
    if (!usesFullSpellList(entity)) return 0;
    const rows = (entity.classTableGroups ?? []).filter(group => group.rowsSpellProgression)
        .map(group => group.rowsSpellProgression[level - 1]);
    if (!rows.length || rows.some(row => !Array.isArray(row))) throw new Error(`Немає таблиці комірок ${entity.name}, рівень ${level}.`);
    return Math.max(0, ...rows.map(row => row.reduce((max, slots, index) => slots > 0 ? index + 1 : max, 0)));
}

export function hasAdditionalClassSpells(cls) {
    const key = `Additional ${cls.entity.name} Spells`;
    return !!cls.state?.featVars?.[key] || (cls.casting?.featureVariants ?? []).some(row => row.on && row.key === key);
}

/** Classes are populated by Plutonium's DataUtil.spell / Renderer.spell. */
export function selectClassSpells(spells, cls, getClasses = (spell, prop) => spell.classes?.[prop] ?? []) {
    const maximum = maximumClassSpellLevel(cls.entity, cls.level);
    const matches = row => lower(row.name) === lower(cls.entity.name) && lower(row.source) === lower(cls.entity.source);
    const candidates = spells.filter(spell => spell.level > 0 && spell.level <= maximum && (
        getClasses(spell, 'fromClassList').some(matches)
        || getClasses(spell, 'fromClassListVariant').some(row => matches(row) && (
            !row.definedInSource || lower(row.definedInSource) === lower(spell.source) || hasAdditionalClassSpells(cls)
        ))
    ));
    const identities = new Set(candidates.map(spell => `${lower(spell.name)}|${lower(spell.source)}`));
    // Suppress an obsolete printing only when its explicit replacement is in this class list.
    return candidates.filter(spell => !(spell.reprintedAs ?? []).some(ref => {
        const uid = typeof ref === 'string' ? ref : ref.uid;
        return uid && identities.has(lower(uid));
    }));
}

/** Preserve selected and always-prepared spells; add only absent identities per class. */
export async function expandClassSpellLists(classes, selected, adapter, notes, cacheEntity = () => {}) {
    const result = [...selected];
    for (const cls of classes) {
        if (!usesFullSpellList(cls.entity) || !maximumClassSpellLevel(cls.entity, cls.level)) continue;
        const spells = await adapter.classSpellList(cls);
        if (!spells.length) throw new Error(`Plutonium повернув порожній список заклять ${cls.entity.name}. Імпорт зупинено.`);
        const existing = new Set(result.filter(row => row.classSlug === cls.slug && ['class', 'subclass'].includes(row.kind))
            .map(row => {
                const uid = row.uid ?? row.key;
                return row.slug || (uid?.includes('|') ? slugFor(...uid.split('|')) : null);
            }).filter(Boolean));
        let added = 0;
        for (const spell of spells) {
            const slug = slugFor(spell.name, spell.source);
            if (existing.has(slug)) continue;
            result.push({slug, origin: `class:${cls.slug}`, classSlug: cls.slug, kind: 'class', prep: false,
                ability: cls.casting?.spellStats?.ability ?? cls.entity.spellcastingAbility});
            cacheEntity(slug, spell);
            existing.add(slug);
            added++;
        }
        notes.push(`${cls.entity.name} ${cls.level}: додано ${added} непідготовлених заклять зі списку класу (кола 1–${maximumClassSpellLevel(cls.entity, cls.level)}).`);
        if (cls.entity.name === 'Ranger') notes.push('Слідопит 2024 може замінити лише одне підготовлене закляття після довгого відпочинку; список доступних заклять не скасовує це обмеження.');
    }
    return result;
}
