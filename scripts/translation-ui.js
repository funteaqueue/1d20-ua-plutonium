import {MODULE_ID} from './constants.js';
import {isTranslated, translateItem, revertItem, translateActor} from './translate.js';

const busy = new WeakSet();
const t = key => game.i18n.localize(`${MODULE_ID}.UI.${key}`);
const editable = doc => !!doc?.isOwner && (!doc.pack || !game.packs.get(doc.pack)?.locked);

export async function runTranslationAction(doc, action) {
    if (!editable(doc) || busy.has(doc)) return;
    busy.add(doc);
    try {
        if (action === 'spells') {
            const {completeCharacterSpellLists} = await import('./character-spell-completion.js');
            await completeCharacterSpellLists(doc);
        } else if (action === 'all') {
            const count = await translateActor(doc);
            ui.notifications.info(game.i18n.format(`${MODULE_ID}.UI.TranslatedCount`, {count}));
        } else {
            const changed = action === 'original' ? await revertItem(doc) : await translateItem(doc);
            if (changed) ui.notifications.info(t(action === 'original' ? 'Restored' : 'Translated'));
            else ui.notifications.warn(t('NoTranslation'));
        }
    } catch (error) {
        console.error(`${MODULE_ID} | Manual translation failed`, error);
        ui.notifications.error(action === 'spells' ? `1d20: ${error.message}` : t('Failed'));
    } finally { busy.delete(doc); }
}

export function translationActions(doc) {
    if (!editable(doc)) return [];
    if (doc.documentName === 'Actor') return [
        {id: 'all', label: t('TranslateAll'), icon: 'fa-solid fa-language'},
        ...(doc.type === 'character' ? [{id: 'spells', label: t('CompleteSpellLists'), icon: 'fa-solid fa-book-open'}] : [])
    ];
    if (doc.documentName !== 'Item') return [];
    if (isTranslated(doc) && doc.flags?.[MODULE_ID]?.original) return [{id: 'original', label: t('RestoreOriginal'), icon: 'fa-solid fa-rotate-left'}];
    return [{id: 'translate', label: t('Translate'), icon: 'fa-solid fa-language'}];
}

function addHeader(app, controls, legacy = false) {
    const doc = app.document ?? app.object;
    for (const entry of translationActions(doc)) {
        const action = `${MODULE_ID}-${entry.id}`;
        if (controls.some(control => control.action === action || control.class === action)) continue;
        const click = () => runTranslationAction(doc, entry.id);
        controls.push(legacy ? {label: entry.label, icon: entry.icon, class: action, onclick: click}
            : {label: entry.label, icon: entry.icon, action, onClick: click});
    }
}

export function initTranslationUI() {
    // The dnd5e three-dot menu reads these controls, including onClick, in v13/v14.
    Hooks.on('getHeaderControlsApplicationV2', (app, controls) => addHeader(app, controls));
    Hooks.on('getApplicationHeaderButtons', (app, buttons) => addHeader(app, buttons, true));
    Hooks.on('getApplicationV1HeaderButtons', (app, buttons) => addHeader(app, buttons, true));
    Hooks.on('dnd5e.getItemContextOptions', (item, options) => {
        for (const entry of translationActions(item)) {
            const click = () => runTranslationAction(item, entry.id);
            // 5.3 uses HTML icons and name/callback; 6.x uses CSS classes and label/onClick.
            options.push(Number(game.system.version.split('.')[0]) >= 6
                ? {label: entry.label, icon: entry.icon, onClick: click}
                : {name: entry.label, icon: `<i class="${entry.icon}"></i>`, callback: click});
        }
    });
}
