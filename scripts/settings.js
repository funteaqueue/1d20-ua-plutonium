import {MODULE_ID, DEFAULT_BASE_URL} from './constants.js';

export const SETTINGS = {
    TRANSLATE_MODE: 'translateMode',
    BASE_URL: 'baseUrl',
    NAME_MODE: 'nameMode',
    CONVERT_ROLLS: 'convertRolls',
    ATTRIBUTION_LINK: 'attributionLink',
    PASTE_IMPORT: 'pasteImport'
};

export const TRANSLATE_MODES = {
    link: `${MODULE_ID}.Settings.TranslateMode.Link`,
    always: `${MODULE_ID}.Settings.TranslateMode.Always`,
    never: `${MODULE_ID}.Settings.TranslateMode.Never`
};

export const NAME_MODES = {
    uk: `${MODULE_ID}.Settings.NameMode.Uk`,
    both: `${MODULE_ID}.Settings.NameMode.Both`,
    en: `${MODULE_ID}.Settings.NameMode.En`
};

export function registerSettings() {
    const world = (key, extra) => game.settings.register(MODULE_ID, key, {
        name: `${MODULE_ID}.Settings.${key}.Name`,
        hint: `${MODULE_ID}.Settings.${key}.Hint`,
        scope: 'world',
        config: true,
        ...extra
    });

    world(SETTINGS.TRANSLATE_MODE, {type: String, choices: TRANSLATE_MODES, default: 'link'});
    world(SETTINGS.NAME_MODE, {type: String, choices: NAME_MODES, default: 'uk'});
    world(SETTINGS.CONVERT_ROLLS, {type: Boolean, default: true});
    world(SETTINGS.ATTRIBUTION_LINK, {type: Boolean, default: true});
    world(SETTINGS.BASE_URL, {type: String, default: DEFAULT_BASE_URL});

    game.settings.register(MODULE_ID, SETTINGS.PASTE_IMPORT, {
        name: `${MODULE_ID}.Settings.pasteImport.Name`,
        hint: `${MODULE_ID}.Settings.pasteImport.Hint`,
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });
}

export function getSetting(key) {
    return game.settings.get(MODULE_ID, key);
}

/** 'link' (translate only imports started from a 1d20 link), 'always', or 'never'. */
export function getTranslateMode() {
    return getSetting(SETTINGS.TRANSLATE_MODE) ?? 'link';
}

export function getBaseUrl() {
    return (getSetting(SETTINGS.BASE_URL) || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}
