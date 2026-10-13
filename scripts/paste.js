import {MODULE_ID, PLUTONIUM_ID, PAGE_TO_TYPE, TYPE_TO_PAGE} from './constants.js';
import {SETTINGS, getSetting} from './settings.js';
import {hashKey, findBySlug, slugFor} from './data.js';
import {requestTranslation} from './translate.js';

/**
 * Paste-to-import: paste a 5e.tools or 1d20.com.ua link anywhere in Foundry and import
 * it via Plutonium.
 *
 * A 5e.tools link imports the English original. A 1d20.com.ua link is resolved to the
 * same 5etools entity (via the 1d20 slug -> name_en + source) and imported with the
 * Ukrainian translation applied — in the default "link" translate mode this is the
 * only thing that gets translated. If the bundled packs don't know the slug (data
 * older than the site), the slug is matched against the 5etools data Plutonium has
 * loaded and the English original is imported instead.
 *
 * Pasting while pointing at (or focused inside) an open actor sheet imports onto that
 * actor; pasting anywhere else imports into the world directory, where Plutonium's own
 * folder rules apply. Creatures always import as world actors.
 *
 * Relies on Plutonium globals (DataLoader) and its public API (game.plutonium.importer),
 * the same path its Rivet browser extension uses. If Plutonium is missing or its API
 * shape changes, the feature stays inert — pasting is never blocked.
 *
 * Translation itself is not done here: the imported documents pass through the
 * preCreateItem/createItem hooks in translate.js; this file only flags which
 * imports asked for it (requestTranslation).
 */

// Pages we import from, keyed by the .html page name a 5e.tools URL carries.
// isAcceptActor mirrors Plutonium's own importer metadata: whether the entity
// can be imported onto an actor rather than into the world directory.
const PAGES = {
    'spells.html': {label: 'spell', isAcceptActor: true},
    'items.html': {label: 'item', isAcceptActor: true},
    'feats.html': {label: 'feat', isAcceptActor: true},
    'optionalfeatures.html': {label: 'optional feature', isAcceptActor: true},
    'backgrounds.html': {label: 'background', isAcceptActor: true},
    'races.html': {label: 'race', isAcceptActor: true},
    'bestiary.html': {label: 'creature', isAcceptActor: false}
};

const URL_5ETOOLS = /https?:\/\/(?:www\.)?5e\.tools\/([a-z][\w-]*\.html)#([^\s"'<>]+)/gi;
// https://1d20.com.ua/spells/fireball-xphb/  -> type "spells", slug "fireball-xphb"
const URL_1D20 = /https?:\/\/(?:www\.)?1d20\.com\.ua\/([a-z]+)\/([a-z0-9][a-z0-9-]*)\/?(?=[\s"'<>?#]|$)/gi;

/**
 * Parse every supported link out of pasted text, in order of appearance.
 * @param {string} text
 * @returns {Array<{page: string, fragment: string}|{type: string, slug: string}>}
 */
export function parseLinks(text) {
    const links = [];
    for (const match of text.matchAll(URL_5ETOOLS)) {
        const page = match[1].toLowerCase();
        if (PAGES[page]) links.push({at: match.index, page, fragment: match[2]});
    }
    for (const match of text.matchAll(URL_1D20)) {
        const type = match[1].toLowerCase();
        if (TYPE_TO_PAGE[type]) links.push({at: match.index, type, slug: match[2].toLowerCase()});
    }
    // Keep document order when both kinds are mixed in one paste.
    return links.sort((a, b) => a.at - b.at);
}

export function initPaste() {
    if (!game.modules.get(PLUTONIUM_ID)?.active) return;

    document.addEventListener('paste', event => {
        handlePaste(event).catch(error => {
            console.error(`${MODULE_ID} | Paste import failed`, error);
        });
    });
    console.log(`${MODULE_ID} | Plutonium paste-to-import enabled`);
}

async function handlePaste(event) {
    if (!getSetting(SETTINGS.PASTE_IMPORT)) return;

    // Never hijack a paste aimed at a text field, editor, or the chat box.
    const target = event.composedPath?.()[0] ?? event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) return;

    const text = event.clipboardData?.getData('text/plain') ?? '';
    const links = parseLinks(text);
    if (!links.length) return;

    const api = getPlutoniumApi();
    if (!globalThis.DataLoader?.pCacheAndGetHash || !api?.importer?.pGetImporter) {
        console.warn(`${MODULE_ID} | Plutonium paste: DataLoader=${!!globalThis.DataLoader}, `
            + `game.plutonium=${!!game.plutonium}, globalThis.plutonium=${!!globalThis.plutonium}, `
            + `module api=${!!game.modules.get(PLUTONIUM_ID)?.api}, importer=${!!api?.importer}`);
        ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.Notifications.PlutoniumApiMissing`));
        return;
    }

    const actor = resolveTargetActor(target);
    for (const link of links) {
        const resolved = link.slug ? await resolve1d20Link(link) : link;
        if (resolved) await importLink(api, resolved, actor);
    }
}

/**
 * Turn a 1d20 link into the matching 5etools page + hash, and ask for the
 * translation to be applied to whatever Plutonium creates for it. When the packs
 * don't know the slug, fall back to the 5etools data itself (English original).
 * @param {{type: string, slug: string}} link
 * @returns {Promise<{page: string, fragment: string}|null>}
 */
export async function resolve1d20Link({type, slug}) {
    const page = TYPE_TO_PAGE[type];
    const translatable = Object.values(PAGE_TO_TYPE).includes(type);
    let entry = null;
    try {
        entry = await findBySlug(type, slug, {translatable});
    } catch (error) {
        // Packs unreadable: still try the 5etools data below.
        console.error(`${MODULE_ID} | Could not load 1d20 data for ${type}`, error);
    }
    if (entry?.name_en && entry.source) {
        const hash = hashKey(entry.name_en, entry.source);
        if (translatable) requestTranslation(type, hash);
        return {page, fragment: hash};
    }

    const entity = await findEntityBySlug(page, slug);
    if (!entity) {
        ui.notifications.warn(game.i18n.format(`${MODULE_ID}.Notifications.SlugNotFound`, {slug, type}));
        return null;
    }
    ui.notifications.info(game.i18n.format(`${MODULE_ID}.Notifications.OriginalFallback`, {name: entity.name}));
    return {page, fragment: hashKey(entity.name, entity.source)};
}

/**
 * Search the 5etools data Plutonium has loaded (site, then prerelease and homebrew)
 * for the entity whose 1d20-style slug matches.
 * @param {string} page
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
async function findEntityBySlug(page, slug) {
    const loaders = [
        () => DataLoader.pCacheAndGetAllSite(page, {isSilent: true}),
        () => DataLoader.pCacheAndGetAllPrerelease?.(page, {isSilent: true}),
        () => DataLoader.pCacheAndGetAllBrew?.(page, {isSilent: true})
    ];
    for (const load of loaders) {
        let entities;
        try {
            entities = await load();
        } catch (error) {
            console.warn(`${MODULE_ID} | Could not list 5etools entities for ${page}`, error);
            continue;
        }
        const match = (entities ?? []).find(entity => entity?.name && entity.source && slugFor(entity.name, entity.source) === slug);
        if (match) return match;
    }
    return null;
}

/**
 * Plutonium publishes its API in several places depending on version/mode;
 * take whichever is present.
 * @returns {object|null}
 */
function getPlutoniumApi() {
    return game.plutonium ?? globalThis.plutonium ?? game.modules.get(PLUTONIUM_ID)?.api ?? null;
}

/**
 * Find the actor the paste is aimed at: the sheet containing the paste target,
 * or failing that the sheet currently under the mouse cursor.
 * @param {EventTarget} target
 * @returns {Actor|null}
 */
function resolveTargetActor(target) {
    if (target instanceof Element) {
        const actor = actorFromElement(target);
        if (actor) return actor;
    }
    // :hover matches every element under the cursor; the last one is the deepest.
    const hovered = [...document.querySelectorAll('.application:hover, .app:hover')].at(-1);
    return hovered ? actorFromElement(hovered) : null;
}

/**
 * Resolve the Foundry application that owns an element (ApplicationV2 via
 * foundry.applications.instances, legacy AppV1 via ui.windows) and return its actor.
 * @param {Element} element
 * @returns {Actor|null}
 */
function actorFromElement(element) {
    const appElement = element.closest('.application, .app');
    if (!appElement) return null;
    const app = foundry.applications?.instances?.get(appElement.id)
        ?? ui.windows?.[appElement.dataset.appid];
    const doc = app?.actor ?? app?.document;
    return doc instanceof Actor ? doc : null;
}

function safeDecodeUri(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

async function importLink(api, {page, fragment}, actor) {
    const {label, isAcceptActor} = PAGES[page];
    // A 5e.tools fragment is "<hash>[,<subhash>...]"; the hash is "<name>_<source>",
    // URI-encoded. pCacheAndGetHash derives the source from the hash itself.
    const hash = fragment.split(',')[0];
    const displayName = safeDecodeUri(hash.split('_')[0]);
    const targetActor = isAcceptActor ? actor : null;

    try {
        const entity = await DataLoader.pCacheAndGetHash(page, hash);
        if (!entity) {
            ui.notifications.warn(`Could not find ${label} "${safeDecodeUri(hash)}". Homebrew sources may need to be loaded in Plutonium first.`);
            return;
        }

        const importer = await api.importer.pGetImporter({page});
        if (!importer) {
            ui.notifications.warn(`Plutonium has no importer for "${page}".`);
            return;
        }

        const importOpts = new api.importer.ImportOpts({actor: targetActor});
        const summary = await importer.pImportEntry(entity, importOpts);
        if (summary?.doNotification) summary.doNotification();
        else ui.notifications.info(`Imported ${label} "${entity.name ?? displayName}"${targetActor ? ` to "${targetActor.name}"` : ''}.`);
    } catch (error) {
        console.error(`${MODULE_ID} | Failed to import ${label} "${displayName}" (${hash})`, error);
        ui.notifications.error(`Failed to import ${label} "${displayName}": ${error.message}`);
    }
}
