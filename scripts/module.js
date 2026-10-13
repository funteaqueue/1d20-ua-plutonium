import {MODULE_ID, PLUTONIUM_ID, PRELOAD_TYPES} from './constants.js';
import {registerSettings, getTranslateMode} from './settings.js';
import {getManifest, loadPack, refresh, getDataInfo, preload, hashKey} from './data.js';
import {initTranslationHooks, translateItem, translateActor, translateWorld, revertItem, describeSource, convertRolls, requestTranslation} from './translate.js';
import {initPaste} from './paste.js';

Hooks.once('init', () => {
    registerSettings();
});

Hooks.once('ready', () => {
    const plutoniumActive = game.modules.get(PLUTONIUM_ID)?.active;
    if (!plutoniumActive) {
        console.warn(`${MODULE_ID} | Plutonium is not active; translations only apply to documents it imports, so the module stays idle.`);
    }

    initTranslationHooks();
    initPaste();

    if (plutoniumActive && getTranslateMode() === 'always') {
        // Every import will need the packs: warm the common ones so preCreateItem
        // can translate synchronously. In 'link' mode the paste handler loads the
        // pack it needs before importing, so nothing is fetched up front.
        setTimeout(() => preload(PRELOAD_TYPES), 5000);
    }

    game.modules.get(MODULE_ID).api = {
        data: {getManifest, loadPack, refresh, getDataInfo, hashKey},
        describeSource,
        convertRolls,
        translateItem,
        translateActor,
        translateWorld,
        revertItem,
        requestTranslation
    };
    console.log(`${MODULE_ID} | Ready (Plutonium ${plutoniumActive ? 'active' : 'missing'}, translate mode "${getTranslateMode()}")`);
});
