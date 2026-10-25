import {MODULE_ID} from './constants.js';
import {array, escapeHTML} from './character-plan.js';

/** Only user-entered rows: calculated class resources are already supplied by Plutonium. */
export function customResourceFeatures(state, {randomID, notes}) {
    return array(state.resources).flatMap((row, index) => {
        const name = String(row?.label ?? '').trim();
        const value = String(row?.value ?? '').trim();
        if (!name) {
            if (value) notes.push(`Власний ресурс №${index + 1}: немає назви, запис залишено у вихідних даних.`);
            return [];
        }
        // The site's value is free text. Never turn arbitrary text into a roll formula.
        const numeric = /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
        const item = {
            _id: randomID(), name, type: 'feat', img: 'icons/svg/book.svg', effects: [],
            system: {
                description: {value: `<p>Власний ресурс із конструктора 1d20.</p><p>Значення: ${escapeHTML(value || 'не вказано')}.</p>`},
                uses: {spent: 0, max: numeric ? String(Number(value)) : '', recovery: []},
                activities: {}
            },
            flags: {[MODULE_ID]: {customResource: {index, label: name, value}}}
        };
        if (numeric) {
            const id = randomID();
            item.system.activities[id] = {
                _id: id, name: 'Витратити 1', type: 'utility',
                activation: {type: '', value: null},
                consumption: {spellSlot: false, targets: [{type: 'itemUses', target: '', value: '1', scaling: {mode: ''}}]}
            };
            item.system.description.value += '<p>Використання витрачає 1 одиницю. Автоматичне відновлення не задано: його можна налаштувати в Foundry.</p>';
        } else notes.push(`Власний ресурс «${name}»: значення «${value || 'порожньо'}» збережено в описі; для лічильника потрібне ціле невід’ємне число.`);
        return [item];
    });
}
