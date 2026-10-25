import {MODULE_ID, CACHE_NAME, BUNDLED_BASE_URL} from './constants.js';
import {getBaseUrl} from './settings.js';

/**
 * Data access for the 1d20.com.ua translation packs.
 *
 * The site publishes a manifest plus one JSON pack per entity type. Packs are large
 * (items ~8 MB), so each one is fetched once, stored in the browser's Cache Storage
 * under a key that includes its sha1 from the manifest, and parsed into an in-memory
 * index keyed the same way Plutonium keys its imports: a 5etools name/source hash,
 * or the full composite UID hash for class and subclass features.
 * A new manifest version therefore re-downloads only the packs whose sha1 changed.
 */

const state = {
    /** Base URL actually in use (configured one, or the local mirror after a fallback). */
    base: null,
    manifest: null,
    manifestPromise: null,
    /** type -> {promise: Promise<Map>, index: Map|null, bySlug: Map|null, meta: object|null, attribution: string|null} */
    packs: new Map(),
    /** type -> Promise<Map<slug, row>> of the lighter catalogue index (index/{type}.json). */
    catalogues: new Map()
};

/**
 * Build the 5etools hash for a name/source pair, exactly like Plutonium's
 * UrlUtil.encodeForHash: encodeURIComponent of the lowercased string, lowercased again.
 * @param {string} name
 * @param {string} source
 * @returns {string}
 */
export function hashKey(name, source) {
    const encode = value => encodeURIComponent(String(value ?? '').toLowerCase()).toLowerCase();
    return `${encode(name)}_${encode(source)}`;
}

export const isFeaturePack = type => type === 'classfeatures' || type === 'subclassfeatures';

/** Expand 5etools feature UID defaults before building its composite hash.
 * Class source defaults to PHB; feature source defaults to its class/subclass
 * source. Display text after the UID is not part of the identity. */
export function featureHashKey(type, uid) {
    if (!isFeaturePack(type) || typeof uid !== 'string') return null;
    const fields = uid.split('|').map(value => value.trim());
    const [name, className, rawClassSource] = fields;
    const classSource = rawClassSource || 'PHB';
    const subclass = type === 'subclassfeatures';
    const level = fields[subclass ? 5 : 3];
    if (!name || !className || !/^\d+$/.test(level ?? '') || (subclass && !fields[3])) return null;
    const parts = subclass
        ? [name, className, classSource, fields[3], fields[4] || 'PHB', Number(level), fields[6] || fields[4] || 'PHB']
        : [name, className, classSource, Number(level), fields[4] || classSource];
    return parts.map(value => encodeURIComponent(String(value).toLowerCase()).toLowerCase()).join('_');
}

/** Some adapted legacy subclasses retain PHB in the site's UID while their
 * canonical page explicitly targets an XPHB class. Only alias that exact page;
 * never substitute editions based on a feature name alone. */
export function adaptedSubclassFeatureHash(entry) {
    if (!featureHashKey('subclassfeatures', entry?.uid)) return null;
    const fields = entry.uid.split('|').map(value => value.trim());
    if ((fields[2] || 'PHB').toUpperCase() !== 'PHB') return null;
    const slug = slugFor(`${fields[1]}-XPHB-${fields[3]}`, fields[4] || 'PHB');
    let url;
    try { url = new URL(entry.url); } catch { return null; }
    if (url.origin !== 'https://1d20.com.ua' || url.pathname !== `/subclasses/${slug}/`) return null;
    fields[2] = 'XPHB';
    return featureHashKey('subclassfeatures', fields.join('|'));
}

/**
 * Rebuild the slug 1d20.com.ua gives an entity from its English name and source,
 * e.g. ("Bigby's Hand", "PHB") -> "bigbys-hand-phb". Verified against every entry
 * in the bundled packs. Lets a 1d20 link be resolved even when the entity is
 * missing from the packs, by matching the slug against 5etools data instead.
 * @param {string} name
 * @param {string} source
 * @returns {string}
 */
export function slugFor(name, source) {
    return `${name}-${source}`
        .toLowerCase()
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/(\d),(\d)/g, '$1$2')
        .replace(/×/g, 'x')
        .replace(/'/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Base URLs to try, in order: the configured one, then the bundled data. */
function candidateBases() {
    const configured = getBaseUrl();
    return configured === BUNDLED_BASE_URL ? [configured] : [configured, BUNDLED_BASE_URL];
}

async function fetchJson(url, init) {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
}

/**
 * Fetch the manifest, memoised for the session. Falls back to the bundled data when
 * a custom base is unreachable (e.g. the remote site without CORS headers).
 * @param {{force?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function getManifest({force = false} = {}) {
    if (state.manifest && !force) return state.manifest;
    if (state.manifestPromise && !force) return state.manifestPromise;

    state.manifestPromise = (async () => {
        const errors = [];
        for (const base of candidateBases()) {
            try {
                const response = await fetchJson(`${base}/manifest.json`, {cache: 'no-cache'});
                const manifest = await response.json();
                if (!manifest?.uk) throw new Error(`${base}/manifest.json has no "uk" section (format ${manifest?.format})`);
                if (state.base && state.base !== base) {
                    state.packs.clear();
                    state.catalogues.clear();
                }
                state.base = base;
                state.manifest = manifest;
                if (errors.length) console.warn(`${MODULE_ID} | Using bundled data ${base} because the configured source failed:`, errors[0]);
                console.log(`${MODULE_ID} | 1d20 data version ${manifest.version} from ${base}`);
                pruneCache(manifest, base).catch(error => console.warn(`${MODULE_ID} | Cache prune failed`, error));
                return manifest;
            } catch (error) {
                errors.push(error);
            }
        }
        throw new Error(`Could not load the 1d20 manifest from ${candidateBases().join(' or ')}: ${errors.map(e => e.message).join('; ')}`);
    })();
    state.manifestPromise.catch(() => {}).finally(() => { state.manifestPromise = null; });
    return state.manifestPromise;
}

async function openCache() {
    if (!globalThis.caches) return null;
    try {
        return await caches.open(CACHE_NAME);
    } catch {
        return null;
    }
}

function cacheKey(base, meta) {
    return `${base}/${meta.file}?sha1=${meta.sha1}`;
}

/** Drop cached packs that the current manifest no longer references. */
async function pruneCache(manifest, base) {
    const cache = await openCache();
    if (!cache) return;
    const keep = new Set([...Object.values(manifest.uk ?? {}), ...Object.values(manifest.index ?? {})]
        .map(meta => new URL(cacheKey(base, meta), location.href).href));
    for (const request of await cache.keys()) {
        if (!keep.has(request.url)) await cache.delete(request);
    }
}

async function fetchPackJson(base, meta) {
    const cache = await openCache();
    const key = cacheKey(base, meta);
    if (cache) {
        const hit = await cache.match(key);
        if (hit) return hit.json();
    }
    const response = await fetchJson(`${base}/${meta.file}`);
    if (cache) {
        try {
            await cache.put(key, response.clone());
        } catch (error) {
            console.warn(`${MODULE_ID} | Could not cache ${meta.file}`, error);
        }
    }
    return response.json();
}

/**
 * Load a translation pack (e.g. "spells") and index it by 5etools hash.
 * Memoised per session; a failed load can be retried.
 * @param {string} type
 * @returns {Promise<Map<string, object>>}
 */
export function loadPack(type) {
    const existing = state.packs.get(type);
    if (existing) return existing.promise;

    const record = {promise: null, index: null, aliases: new Map(), bySlug: null, meta: null, attribution: null};
    record.promise = (async () => {
        const manifest = await getManifest();
        const meta = manifest.uk?.[type];
        // An older custom mirror may not yet publish the new feature packs.
        // Missing translations must not block an otherwise valid character import.
        if (!meta && isFeaturePack(type)) {
            console.warn(`${MODULE_ID} | No ${type} pack in this data source; keeping original feature text.`);
            record.index = new Map();
            return record.index;
        }
        if (!meta) throw new Error(`The 1d20 manifest has no "${type}" pack`);

        const pack = await fetchPackJson(state.base, meta);
        const index = new Map();
        const bySlug = new Map();
        for (const entry of pack.entries ?? []) {
            if (!entry?.name_en) continue;
            const key = isFeaturePack(type) ? featureHashKey(type, entry.uid) : entry.source ? hashKey(entry.name_en, entry.source) : null;
            if (!key) continue;
            index.set(key, entry);
            if (entry.slug) bySlug.set(entry.slug, entry);
            if (type === 'subclassfeatures') {
                const alias = adaptedSubclassFeatureHash(entry);
                // Ambiguous aliases remain unavailable; exact UIDs always win.
                if (alias) record.aliases.set(alias, record.aliases.has(alias) ? null : entry);
            }
        }
        record.index = index;
        record.bySlug = bySlug;
        record.meta = meta;
        record.attribution = pack.attribution ?? manifest.attribution ?? null;
        console.log(`${MODULE_ID} | Loaded ${type}: ${index.size} translations`);
        return index;
    })();
    record.promise.catch(error => {
        state.packs.delete(type);
        console.error(`${MODULE_ID} | Failed to load pack "${type}"`, error);
    });
    state.packs.set(type, record);
    return record.promise;
}

/**
 * Synchronous lookup: only answers when the pack is already in memory.
 * @param {string} type
 * @param {string} key
 * @returns {object|null|undefined} undefined = pack not loaded yet
 */
export function findLoaded(type, key) {
    const index = state.packs.get(type)?.index;
    if (!index) return undefined;
    return index.get(key) ?? state.packs.get(type).aliases.get(key) ?? null;
}

/**
 * @param {string} type
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function find(type, key) {
    await loadPack(type);
    return findLoaded(type, key);
}

/**
 * Load the catalogue index for a type (index/{type}.json): one row per entity with
 * slug, name_en and source, but no translated text. Much smaller than the uk pack,
 * so it's what we use to resolve a 1d20 link for types we don't translate (bestiary).
 * @param {string} type
 * @returns {Promise<Map<string, object>>} slug -> row
 */
export function loadCatalogue(type) {
    const existing = state.catalogues.get(type);
    if (existing) return existing;
    const promise = (async () => {
        const manifest = await getManifest();
        const meta = manifest.index?.[type];
        if (!meta) throw new Error(`The 1d20 manifest has no "${type}" index`);
        const rows = await fetchPackJson(state.base, meta);
        const bySlug = new Map();
        for (const row of Array.isArray(rows) ? rows : rows?.entries ?? []) {
            if (row?.slug) bySlug.set(row.slug, row);
        }
        return bySlug;
    })();
    promise.catch(error => {
        state.catalogues.delete(type);
        console.error(`${MODULE_ID} | Failed to load index "${type}"`, error);
    });
    state.catalogues.set(type, promise);
    return promise;
}

/**
 * Resolve a 1d20 slug ("fireball-xphb") to its English name and source. Uses the
 * translation pack when we translate that type (it's needed shortly anyway), the
 * catalogue index otherwise.
 * @param {string} type
 * @param {string} slug
 * @param {{translatable: boolean}} options
 * @returns {Promise<{name_en: string, source: string, name_uk?: string}|null>}
 */
export async function findBySlug(type, slug, {translatable}) {
    if (translatable) {
        await loadPack(type);
        const entry = state.packs.get(type)?.bySlug?.get(slug);
        if (entry) return entry;
    }
    // The catalogue is optional for translatable types (the bundle only ships it for
    // types without a translation pack), so its absence is not an error.
    if (!(await getManifest()).index?.[type]) return null;
    const catalogue = await loadCatalogue(type);
    return catalogue.get(slug) ?? null;
}

export function getAttribution(type) {
    return state.packs.get(type)?.attribution ?? state.manifest?.attribution ?? null;
}

export function getDataInfo() {
    return {
        base: state.base,
        version: state.manifest?.version ?? null,
        generatedAt: state.manifest?.generated_at ?? null,
        loaded: [...state.packs.entries()].filter(([, r]) => r.index).map(([type, r]) => ({type, count: r.index.size, sha1: r.meta?.sha1}))
    };
}

/** Warm packs in the background; errors are logged, never thrown. */
export function preload(types) {
    for (const type of types) loadPack(type).catch(() => {});
}

/** Forget everything in memory and in Cache Storage, then re-fetch the manifest. */
export async function refresh() {
    state.packs.clear();
    state.catalogues.clear();
    state.manifest = null;
    state.base = null;
    if (globalThis.caches) {
        try {
            await caches.delete(CACHE_NAME);
        } catch (error) {
            console.warn(`${MODULE_ID} | Could not clear cache`, error);
        }
    }
    return getManifest({force: true});
}
