import {MODULE_ID} from './constants.js';
import {slugFor} from './data.js';
import {escapeHTML} from './character-plan.js';
import {createPlutoniumCharacterAdapter} from './character-plutonium.js';
import {expandClassSpellLists, usesFullSpellList} from './character-spell-lists.js';
import {configureCharacterSpell} from './character-spells.js';

const busy = new WeakSet();
function existingSpellSlug(item) {
    const hash = item.flags?.plutonium?.hash?.split(',')[0];
    if (!hash) return null;
    const index = hash.lastIndexOf('_');
    if (index < 1) return null;
    try { return slugFor(decodeURIComponent(hash.slice(0, index)), decodeURIComponent(hash.slice(index + 1))); }
    catch { return null; }
}

/** Add missing spells only: never replace an existing spell, preparation, or resource counter. */
export async function completeCharacterSpellLists(actor, {adapter, review = true,
    makeActor = source => new CONFIG.Actor.documentClass(source), randomID = () => foundry.utils.randomID()} = {}) {
    if (!actor?.isOwner || actor.type !== 'character' || (actor.pack && game.packs.get(actor.pack)?.locked)) throw new Error('Потрібен власний аркуш персонажа, доступний для редагування.');
    if (busy.has(actor)) throw new Error('Доповнення списків заклять цього персонажа вже триває.');
    busy.add(actor);
    try {
        adapter ??= createPlutoniumCharacterAdapter();
        ui.notifications.info('1d20: збираю доступні закляття класів…');
        const initial = JSON.stringify(actor.toObject());
        const source = actor.toObject(), notes = [], classes = [], selected = [], entities = new Map();
        const state = actor.flags?.[MODULE_ID]?.characterImport?.selections ?? {};
        for (const item of actor.items.filter(item => item.type === 'class')) {
            if (!item.flags?.plutonium?.hash) continue;
            const entity = await adapter.importedClass(item);
            if (!usesFullSpellList(entity)) continue;
            const slug = slugFor(entity.name, entity.source);
            classes.push({entity, item, slug, level: item.system.levels,
                state: state.classSlug === slug ? state : state.multiclass?.find(row => row.slug === slug) ?? {}});
        }
        for (const item of actor.items.filter(item => item.type === 'spell')) {
            const slug = existingSpellSlug(item);
            if (!slug) continue;
            const origin = item.flags?.[MODULE_ID]?.spellOrigin;
            for (const cls of classes) {
                if ((origin?.classSlug === cls.slug && ['class', 'subclass'].includes(origin.kind))
                    || item.system.sourceItem === `class:${cls.item.system.identifier}`) {
                    selected.push({slug, classSlug: cls.slug, kind: 'class'});
                }
            }
        }
        const rows = await expandClassSpellLists(classes, selected, adapter, notes, (slug, entity) => entities.set(slug, entity));
        const additions = rows.slice(selected.length), items = [];
        for (const row of additions) {
            const cls = classes.find(cls => cls.slug === row.classSlug), spell = entities.get(row.slug);
            const item = await adapter.convert('spell', spell, makeActor(source), {
                spellcastingAbilityAbv: row.ability, parentClassName: cls.entity.name, parentClassSource: cls.entity.source,
                stateInitial: {method: 'spell', prepared: 0, activity: {attack: {attackAbility: row.ability}, save: {saveDcCalculation: row.ability}}}
            });
            item._id ||= randomID(); delete item.folder; delete item.ownership;
            await configureCharacterSpell(item, row, spell, {cls, report: notes});
            items.push(item); source.items.push(item);
        }
        if (!items.length) {
            ui.notifications.info(classes.length ? 'Доступні закляття класів уже є в аркуші.' : 'Не знайдено класів Plutonium, які готують закляття з повного списку.');
            return 0;
        }
        if (review) {
            const action = await foundry.applications.api.DialogV2.wait({
                window: {title: '1d20: доповнити закляття класів'},
                content: `<p>«${escapeHTML(actor.name)}»: буде додано ${items.length} непідготовлених заклять. Наявні закляття та їх підготовленість збережуться.</p><ul>${notes.map(note => `<li>${escapeHTML(note)}</li>`).join('')}</ul>`,
                buttons: [{action: 'add', label: 'Додати закляття'}, {action: 'cancel', label: 'Скасувати', default: true}], rejectClose: false
            });
            if (action !== 'add') return 0;
        }
        if (!actor.isOwner || (actor.pack && game.packs.get(actor.pack)?.locked) || JSON.stringify(actor.toObject()) !== initial) throw new Error('Аркуш змінився під час підготовки. Повторіть доповнення заклять.');
        const created = await actor.createEmbeddedDocuments('Item', items, {keepId: true});
        ui.notifications.info(`1d20: додано ${created.length} непідготовлених заклять.`);
        return created.length;
    } finally { busy.delete(actor); }
}
