import {PLUTONIUM_ID} from './constants.js';
import {hashKey, slugFor, find} from './data.js';
import {buildUpdate, describeSource} from './translate.js';
import {getTranslateMode} from './settings.js';
import {characterSystemMajor} from './character-compat.js';

const copy = value => structuredClone(value);
const lower = value => String(value ?? '').toLowerCase();

/** Composite identities are essential: subclass names alone are not unique. */
export function matchCharacterEntity(type, slug, reference, entities, parent) {
    const source = reference?.source;
    const name = reference?.nameEn;
    let matches;
    if (type === 'subclasses') {
        matches = entities.filter(row => lower(row.source) === lower(source) && lower(row.name) === lower(name)
            && lower(row.className) === lower(parent?.name));
        const exactParent = matches.filter(row => lower(row.classSource) === lower(parent?.source));
        if (exactParent.length) matches = exactParent;
    } else if (type === 'subraces') {
        matches = entities.filter(row => lower(row.source) === lower(source)
            && (lower(row._subraceName) === lower(name) || lower(row.name) === lower(`${parent?.name} (${name})`))
            && (!row._baseName || lower(row._baseName) === lower(parent?.name))
            && (!row._baseSource || lower(row._baseSource) === lower(parent?.source)));
    } else {
        matches = entities.filter(row => row?.name && row.source && slugFor(row.name, row.source) === slug);
        // Accept only an explicitly declared publication of the same entity, never
        // a similarly named replacement or a guessed edition.
        if (!matches.length) matches = entities.filter(row => row?.name && row.otherSources?.some(other => slugFor(row.name, other.source) === slug));
    }
    if (matches.length > 1) throw new Error(`Неоднозначна сутність ${type}: ${slug} (${matches.length} збігів).`);
    return matches[0] ?? null;
}

export function createPlutoniumCharacterAdapter() {
    const api = game.plutonium ?? globalThis.plutonium ?? game.modules.get(PLUTONIUM_ID)?.api;
    if (!game.modules.get(PLUTONIUM_ID)?.active || !api?.importer?.pGetImporter || !globalThis.DataLoader) throw new Error('Plutonium не активний або його API недоступний.');
    if (game.system.id !== 'dnd5e') throw new Error('Імпорт потребує системи dnd5e.');
    characterSystemMajor(game.system.version);
    const importers = new Map(), lists = new Map();
    let rawPromise;
    const rawClasses = () => rawPromise ??= DataUtil.class.loadRawJSON();
    const pages = {classes: 'class', subclasses: 'subclass', races: 'races.html', subraces: 'races.html', backgrounds: 'backgrounds.html', feats: 'feats.html', optionalFeatures: 'optionalfeatures.html', items: 'items.html', spells: 'spells.html'};
    const list = async page => {
        if (!lists.has(page)) lists.set(page, (async () => {
            const rows = [];
            for (const method of ['pCacheAndGetAllSite', 'pCacheAndGetAllPrerelease', 'pCacheAndGetAllBrew']) {
                if (typeof DataLoader[method] === 'function') rows.push(...(await DataLoader[method](page, {isSilent: true}) ?? []));
            }
            const unique = new Map();
            for (const row of rows) unique.set(JSON.stringify([row.name, row.source, row.className, row.classSource, row._subraceName, row._baseName]), row);
            return [...unique.values()];
        })());
        return lists.get(page);
    };
    const getFeature = async (prop, ref) => {
        const uid = typeof ref === 'string' ? ref : ref[prop];
        if (!uid) throw new Error(`Невідомий формат ${prop}.`);
        const meta = prop === 'classFeature' ? DataUtil.class.unpackUidClassFeature(uid) : DataUtil.class.unpackUidSubclassFeature(uid);
        const hash = UrlUtil.URL_TO_HASH_BUILDER[prop](meta);
        const entity = await DataLoader.pCacheAndGet(prop, meta.source, hash, {isRequired: true});
        if (!entity) throw new Error(`Не знайдено ${uid}.`);
        return copy(entity);
    };
    return {
        async resolve(type, slug, reference, parent) {
            if (type === 'subraces' && reference?.data?.base) return copy(parent);
            const page = pages[type];
            if (!page) throw new Error(`Невідомий тип ${type}.`);
            let entity;
            if (!['subclasses', 'subraces'].includes(type) && reference?.nameEn && reference.source && slugFor(reference.nameEn, reference.source) === slug) {
                entity = await DataLoader.pCacheAndGetHash(page, hashKey(reference.nameEn, reference.source));
                if (entity && slugFor(entity.name, entity.source) !== slug) entity = null;
            }
            if (!entity) entity = matchCharacterEntity(type, slug, reference, await list(page), parent);
            if (!entity) throw new Error(`Plutonium не знайшов ${type}: ${slug}. Перевірте встановлені джерела.`);
            return copy(entity);
        },
        async classFeatures(cls, level) {
            const raw = await rawClasses();
            const rawClass = raw.class.find(row => row.name === cls.name && row.source === cls.source);
            const original = Array.isArray(rawClass?.classFeatures) ? rawClass : cls;
            const out = [];
            for (const ref of original.classFeatures ?? []) {
                if (Array.isArray(ref)) {
                    for (const entity of ref) if (entity.level <= level) out.push(copy(entity));
                    continue;
                }
                if (typeof ref === 'object' && ref.name && ref.level) { if (ref.level <= level) out.push(copy(ref)); continue; }
                const uid = typeof ref === 'string' ? ref : ref.classFeature;
                if (DataUtil.class.unpackUidClassFeature(uid).level <= level) out.push(await getFeature('classFeature', ref));
            }
            return out;
        },
        async subclassFeatures(sc, level) {
            const raw = await rawClasses();
            const rawSubclass = raw.subclass.find(row => row.name === sc.name && row.source === sc.source && row.className === sc.className && row.classSource === sc.classSource);
            const original = Array.isArray(rawSubclass?.subclassFeatures) ? rawSubclass : sc;
            const out = [];
            for (const ref of original.subclassFeatures ?? []) {
                if (Array.isArray(ref)) { for (const entity of ref) if (entity.level <= level) out.push(copy(entity)); continue; }
                if (typeof ref === 'object' && ref.name && ref.level) { if (ref.level <= level) out.push(copy(ref)); continue; }
                const uid = typeof ref === 'string' ? ref : ref.subclassFeature;
                if (DataUtil.class.unpackUidSubclassFeature(uid).level <= level) out.push(await getFeature('subclassFeature', ref));
            }
            return out;
        },
        async choiceFeature(choice, cls, sc, features) {
            const raw = await rawClasses();
            let candidates = [...raw.classFeature ?? [], ...raw.subclassFeature ?? []].filter(row => lower(row.name) === lower(choice.key)
                && lower(row.className) === lower(cls.name) && row.level <= choice.level
                && (!choice.featureLevel || row.level === choice.featureLevel)
                // A legacy subclass attached to a 2024 class still references its
                // original PHB features. Its own source identifies that edition.
                && (row.subclassShortName || lower(row.classSource ?? 'PHB') === lower(cls.source))
                && (!row.subclassShortName || (lower(row.subclassShortName) === lower(sc?.shortName) && lower(row.subclassSource ?? row.source) === lower(sc?.source))));
            const exactSource = candidates.filter(row => row.source === (row.subclassShortName ? sc?.source : cls.source));
            if (exactSource.length) candidates = exactSource;
            if (candidates.length === 1) {
                const prop = candidates[0].subclassShortName ? 'subclassFeature' : 'classFeature';
                const entity = candidates[0]._copy
                    ? await DataLoader.pCacheAndGet(prop, candidates[0].source, UrlUtil.URL_TO_HASH_BUILDER[prop](candidates[0]), {isRequired: true})
                    : candidates[0];
                if (!entity) throw new Error(`Не знайдено дані вибору ${choice.key}.`);
                return {prop, entity: copy(entity)};
            }
            const named = [];
            const walk = (value, parent) => {
                if (!value || typeof value !== 'object') return;
                if (lower(value.name).replace(/\.$/, '') === lower(choice.key).replace(/\.$/, '')) named.push({value, parent});
                if (Array.isArray(value)) value.forEach(row => walk(row, parent));
                else for (const key of ['entries', 'items', 'entry']) walk(value[key], parent);
            };
            for (const feature of features) if (!choice.featureLevel || feature.level === choice.featureLevel) walk(feature.entries, feature);
            if (named.length === 1) {
                const {parent, value} = named[0];
                return {prop: parent.subclassShortName ? 'subclassFeature' : 'classFeature', entity: {...copy(parent), name: value.name, entries: copy(value.entries ?? [value.entry ?? value])}};
            }
            throw new Error(`Не знайдено однозначну вибрану здібність «${choice.key}» (${cls.name}).`);
        },
        raceFeatures(race) {
            return (race.entries ?? []).filter(entry => typeof entry === 'object' && entry.name && entry.name !== 'Size')
                .map(entry => DataUtil.raceFeature.getFauxRaceFeature(race, entry));
        },
        async convert(prop, entity, actor, options = {}) {
            const importerProp = prop === 'subclass' ? 'class' : prop;
            if (!importers.has(importerProp)) importers.set(importerProp, await api.importer.pGetImporter({prop: importerProp}));
            const converter = importers.get(importerProp)?.constructor?._DataConverter;
            const method = prop === 'class' ? 'pGetDocumentJsonClass' : prop === 'subclass' ? 'pGetDocumentJsonSubclass' : 'pGetDocumentJson';
            if (typeof converter?.[method] !== 'function') throw new Error(`Plutonium не надає конвертер ${prop}.`);
            const opts = {actor, isActorItem: true, isEquipped: false, ...options};
            const data = prop === 'subclass' ? await converter[method](copy(options.parentClass), copy(entity), opts) : await converter[method](copy(entity), opts);
            if (!data?.type || !data.system) throw new Error(`Plutonium не зібрав документ ${entity.name}.`);
            const result = copy(data);
            const source = describeSource(result);
            if (source && getTranslateMode() !== 'never') {
                const entry = await find(source.type, source.key);
                if (entry) foundry.utils.mergeObject(result, buildUpdate(result, entry, source.type));
            }
            return result;
        }
    };
}
