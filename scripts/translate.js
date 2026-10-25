import {MODULE_ID, PLUTONIUM_ID, PAGE_TO_TYPE, ATTRIBUTION} from './constants.js';
import {SETTINGS, getSetting, getTranslateMode} from './settings.js';
import {hashKey, isFeaturePack, findLoaded, find, loadPack, getAttribution} from './data.js';

/**
 * Apply 1d20.com.ua translations to documents Plutonium imports.
 *
 * Plutonium stamps flags.plutonium.{page, source, hash} on everything it creates,
 * and the hash is the 5etools name/source or composite feature key. The
 * preCreateItem hook rewrites name and description before the
 * document hits the database when the pack is already in memory; otherwise the
 * pack is loaded and the item is patched right after creation (createItem).
 */

/** Marker on the creation options so createItem knows preCreate deferred the work. */
const PENDING_OPTION = `${MODULE_ID}.pending`;

/**
 * Imports that were started from a 1d20 link and should be translated even in
 * "link" mode. Keyed "<type>:<hash>", valued by expiry time: Plutonium creates the
 * documents asynchronously, so a request stays valid for a short while and is
 * consumed by the first matching document.
 */
const REQUEST_TTL_MS = 60_000;
const requested = new Map();

/** Mark an upcoming Plutonium import as "translate this one". */
export function requestTranslation(type, key) {
    requested.set(`${type}:${key}`, Date.now() + REQUEST_TTL_MS);
}

function consumeRequest(type, key) {
    const id = `${type}:${key}`;
    const expiry = requested.get(id);
    if (expiry === undefined) return false;
    requested.delete(id);
    return expiry >= Date.now();
}

/**
 * Should this Plutonium import be translated, given the translate mode setting?
 * 'always' translates everything, 'never' nothing, 'link' only imports that were
 * requested via a 1d20 link (see requestTranslation).
 * @param {{type: string, key: string}} source
 * @returns {boolean}
 */
function shouldTranslate(source) {
    switch (getTranslateMode()) {
        case 'always': return true;
        case 'never': return false;
        default: return consumeRequest(source.type, source.key);
    }
}

/**
 * Work out which 1d20 pack and key describe a Plutonium-imported document.
 * @param {Item|object} doc  a Document or its creation data
 * @returns {{type: string, key: string}|null}
 */
export function describeSource(doc) {
    const flags = doc?.flags?.[PLUTONIUM_ID];
    if (!flags?.page) return null;
    const type = PAGE_TO_TYPE[flags.page];
    if (!type) return null;

    const hash = typeof flags.hash === 'string' ? flags.hash.split(',')[0].toLowerCase() : null;
    // Feature names alone are ambiguous across classes, levels and editions.
    const key = hash || (!isFeaturePack(type) && flags.source ? hashKey(doc.name, flags.source) : null);
    if (!key) return null;
    return {type, key};
}

const ROLL_PATTERN = /<span\b[^>]*\bdata-dnd-roll="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;
const SAFE_FORMULA = /^[\dd+\-*/().]+$/;

/**
 * Turn 1d20's roll spans into Foundry inline rolls: `8к6` becomes `[[/r 8d6]]{8к6}`.
 * Anything that doesn't look like a plain dice formula is left as its label text.
 * @param {string} html
 * @returns {string}
 */
export function convertRolls(html) {
    return html.replace(ROLL_PATTERN, (match, formula, label) => {
        const normalized = formula.replace(/[кК]/g, 'd').replace(/\s+/g, '').replace(/^d/, '1d');
        const text = label.trim();
        if (!SAFE_FORMULA.test(normalized)) return text;
        return `[[/r ${normalized}]]{${text}}`;
    });
}

/** Does the entry carry the full translated text (format 1 packs), not just a summary? */
export function hasFullText(entry) {
    return Object.values(entry?.html ?? {}).some(value => typeof value === 'string' && value.trim());
}

function attributionFooter(entry, type) {
    if (!getSetting(SETTINGS.ATTRIBUTION_LINK) || !entry.url) return '';
    const label = foundry.utils.escapeHTML(getAttribution(type) ?? ATTRIBUTION);
    return `<p class="source-1d20"><a href="${entry.url}" target="_blank" rel="noopener">${label}</a></p>`;
}

/**
 * Compose the Foundry description for a 1d20 entry: every translated field in
 * pack order (for spells: entries, then "На вищих рівнях"), optional inline rolls,
 * optional attribution link back to the source page.
 *
 * Summary-only entries (format 2 packs carry just the first sentence) return null:
 * the English description is kept rather than replaced by one line. buildUpdate
 * still appends the link footer to it so the full translation is a click away.
 * @param {object} entry
 * @param {string} type
 * @returns {string|null}
 */
export function buildDescription(entry, type) {
    if (!hasFullText(entry)) return null;
    let html = Object.values(entry.html).filter(value => typeof value === 'string' && value.trim()).join('');
    if (getSetting(SETTINGS.CONVERT_ROLLS)) html = convertRolls(html);
    return html + attributionFooter(entry, type);
}

/**
 * The name to give a document, per the "name mode" setting.
 * @param {object} entry
 * @param {string} currentName
 * @returns {string}
 */
export function buildName(entry, currentName) {
    const nameUk = entry.name_uk?.trim();
    if (!nameUk) return currentName;
    switch (getSetting(SETTINGS.NAME_MODE)) {
        case 'uk': return nameUk;
        case 'both': return `${nameUk} (${entry.name_en ?? currentName})`;
        default: return currentName;
    }
}

/**
 * Build the update that applies an entry to a document. Works for both pending
 * documents in preCreate (updateSource) and existing ones (update).
 * @param {Item} doc
 * @param {object} entry
 * @param {string} type
 * @returns {object}
 */
export function buildUpdate(doc, entry, type) {
    const update = {};
    const previous = doc.flags?.[MODULE_ID]?.original;
    const originalName = previous?.name ?? doc.name;
    const originalDescription = previous?.description ?? doc.system?.description?.value ?? null;

    const name = buildName(entry, originalName);
    if (name !== doc.name) update.name = name;

    if (doc.system?.description !== undefined) {
        const description = buildDescription(entry, type);
        if (description != null) {
            update['system.description.value'] = description;
        } else if (originalDescription != null) {
            // No full text available: keep the English description, add the link only.
            const footer = attributionFooter(entry, type);
            if (footer) update['system.description.value'] = originalDescription + footer;
        }
    }

    update[`flags.${MODULE_ID}`] = {
        ...doc.flags?.[MODULE_ID],
        nameEn: entry.name_en ?? originalName,
        source: entry.source,
        ...(entry.uid ? {uid: entry.uid} : {}),
        slug: entry.slug,
        url: entry.url,
        original: {name: originalName, description: originalDescription}
    };
    return update;
}

/** Has this document already been translated by us? */
export function isTranslated(doc) {
    return Boolean(doc?.flags?.[MODULE_ID]?.nameEn);
}

export function initTranslationHooks() {
    Hooks.on('preCreateItem', (item, data, options) => {
        if (isTranslated(item)) return;
        const source = describeSource(item);
        if (!source || !shouldTranslate(source)) return;

        const entry = findLoaded(source.type, source.key);
        if (entry === undefined) {
            // Pack not in memory yet: load it and let createItem finish the job.
            options[PENDING_OPTION] = source;
            loadPack(source.type).catch(() => {});
            return;
        }
        if (!entry) return;
        try {
            item.updateSource(buildUpdate(item, entry, source.type));
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to translate "${item.name}" before creation`, error);
        }
    });

    Hooks.on('createItem', async (item, options, userId) => {
        if (userId !== game.user.id) return;
        const source = options[PENDING_OPTION];
        if (!source || isTranslated(item)) return;
        try {
            const entry = await find(source.type, source.key);
            if (!entry) return;
            await item.update(buildUpdate(item, entry, source.type));
        } catch (error) {
            console.error(`${MODULE_ID} | Failed to translate "${item.name}" after creation`, error);
            ui.notifications.warn(game.i18n.format(`${MODULE_ID}.Notifications.TranslateFailed`, {name: item.name}));
        }
    });
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/**
 * Translate an existing Plutonium-imported item in place.
 * @param {Item} item
 * @param {{force?: boolean}} [options]  force: re-apply even if already translated
 * @returns {Promise<boolean>} true if an update was written
 */
export async function translateItem(item, {force = false} = {}) {
    if (!force && isTranslated(item)) return false;
    const source = describeSource(item);
    if (!source) return false;
    const entry = await find(source.type, source.key);
    if (!entry) return false;
    const update = buildUpdate(item, entry, source.type);
    await item.update(update);
    return true;
}

/**
 * Restore the English name and description saved when the item was translated.
 * @param {Item} item
 * @returns {Promise<boolean>}
 */
export async function revertItem(item) {
    const original = item.flags?.[MODULE_ID]?.original;
    if (!original) return false;
    const update = {name: original.name};
    // Translation metadata shares this namespace with spell origins and custom resources.
    for (const key of ['nameEn', 'source', 'slug', 'url', 'uid', 'original']) update[`flags.${MODULE_ID}.-=${key}`] = null;
    if (original.description != null && item.system?.description !== undefined) {
        update['system.description.value'] = original.description;
    }
    await item.update(update);
    return true;
}

/**
 * Translate every eligible item owned by an actor.
 * @param {Actor} actor
 * @param {{force?: boolean}} [options]
 * @returns {Promise<number>} number of items updated
 */
export async function translateActor(actor, options = {}) {
    const updates = [];
    for (const item of actor.items) {
        if (!options.force && isTranslated(item)) continue;
        const source = describeSource(item);
        if (!source) continue;
        const entry = await find(source.type, source.key);
        if (!entry) continue;
        updates.push({_id: item.id, ...buildUpdate(item, entry, source.type)});
    }
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    return updates.length;
}

/**
 * Translate all world items and all items on world actors.
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{items: number, actors: number}>}
 */
export async function translateWorld(options = {}) {
    let items = 0;
    for (const item of game.items) {
        if (await translateItem(item, options)) items++;
    }
    let actors = 0;
    for (const actor of game.actors) {
        const count = await translateActor(actor, options);
        items += count;
        if (count) actors++;
    }
    return {items, actors};
}
