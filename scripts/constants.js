export const MODULE_ID = '1d20-ua-plutonium';
export const PLUTONIUM_ID = 'plutonium';

/**
 * The 1d20 data bundled with the module (data/manifest.json + the packs it lists),
 * served by Foundry alongside the module's scripts. This is the default source;
 * refresh it with `node tools/mirror.mjs`.
 */
export const BUNDLED_BASE_URL = `modules/${MODULE_ID}/data`;
export const DEFAULT_BASE_URL = BUNDLED_BASE_URL;

/** Where 1d20.com.ua publishes its live data, for anyone who prefers auto-updates. */
export const REMOTE_BASE_URL = 'https://1d20.com.ua/wp-content/uploads/dnd-data';

export const ATTRIBUTION = 'Український переклад: 1d20.com.ua';
export const CACHE_NAME = `${MODULE_ID}-data`;

/**
 * Plutonium tags every document it imports with flags.plutonium.{page, source, hash}.
 * Map its page flag onto the 1d20 pack type that carries translations for it.
 * Bestiary is deliberately absent: creature text is split across embedded items
 * and needs a different mapping.
 */
export const PAGE_TO_TYPE = {
    'spells.html': 'spells',
    'items.html': 'items',
    'feats.html': 'feats',
    'optionalfeatures.html': 'optionalfeatures',
    classFeature: 'classfeatures',
    subclassFeature: 'subclassfeatures',
    'backgrounds.html': 'backgrounds',
    'races.html': 'races'
};

/**
 * 1d20 URL path segment -> 5e.tools page, for paste-to-import of 1d20 links.
 * Types missing from PAGE_TO_TYPE (bestiary) still import, just untranslated.
 */
export const TYPE_TO_PAGE = {
    spells: 'spells.html',
    items: 'items.html',
    feats: 'feats.html',
    optionalfeatures: 'optionalfeatures.html',
    backgrounds: 'backgrounds.html',
    races: 'races.html',
    bestiary: 'bestiary.html'
};

/** Packs worth warming up in the background at ready, most-used first. */
export const PRELOAD_TYPES = ['spells', 'feats', 'optionalfeatures', 'classfeatures', 'subclassfeatures', 'items'];
