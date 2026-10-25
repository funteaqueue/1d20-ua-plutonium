/** Parser and paste preview for the v1 builder export. */
export const CHARACTER_FORMAT = '1d20.character';
const MAX_JSON_LENGTH = 20 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseCharacterExport(input) {
    let data = input;
    if (typeof input === 'string') {
        if (!input.trimStart().startsWith('{')) return null;
        if (input.length > MAX_JSON_LENGTH) throw new Error('JSON персонажа перевищує 20 МБ. Спробуйте експорт без портрета.');
        try { data = JSON.parse(input); }
        catch {
            if (/"format"\s*:\s*"1d20\.character"/.test(input.slice(0, 1000))) throw new Error('JSON персонажа обрізаний або пошкоджений. Скопіюйте його повністю.');
            return null;
        }
    }
    if (!object(data) || data.format !== CHARACTER_FORMAT) return null;
    if (data.schemaVersion !== 1) throw new Error(`Непідтримувана версія експорту: ${data.schemaVersion}. Оновіть модуль.`);
    for (const field of ['character', 'state', 'snapshot', 'references', 'diagnostics', 'rules']) {
        if (!object(data[field])) throw new Error(`В експорті немає об'єкта ${field}.`);
    }
    if (data.rules.system !== 'dnd5e') throw new Error('Експорт має бути для системи dnd5e.');
    if (!Array.isArray(data.character.classes) || !data.character.classes.every(object)) throw new Error('Некоректний список класів.');
    if (!Array.isArray(data.references.entities) || !data.references.entities.every(object)) throw new Error('Некоректний довідник сутностей.');
    for (const field of ['incompleteStages', 'unresolvedReferences', 'warnings']) {
        if (!Array.isArray(data.diagnostics[field]) || !data.diagnostics[field].every(object)) throw new Error(`Некоректна діагностика: ${field}.`);
    }
    return data;
}

export function inspectCharacterExport(input) {
    const data = parseCharacterExport(input);
    if (!data) throw new Error('Це не експорт персонажа 1d20.');
    return {
        name: data.character.name || 'Без імені',
        edition: data.rules.edition,
        level: data.character.level,
        classes: data.character.classes,
        race: data.character.raceSlug,
        background: data.character.backgroundSlug,
        abilities: data.snapshot.abilities ?? null,
        hitPoints: data.snapshot.hitPoints ?? null,
        references: data.references.entities.length,
        diagnostics: data.diagnostics
    };
}

const escape = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function characterPreviewHTML(input) {
    const report = inspectCharacterExport(input);
    const rows = [
        ['Персонаж', report.name], ['Правила', `D&D ${report.edition}`], ['Рівень', report.level],
        ['Класи', report.classes.map(row => `${row.slug} (${row.level})`).join(', ')],
        ['Раса', report.race], ['Передісторія', report.background], ['Максимум HP', report.hitPoints],
        ['Характеристики', Object.entries(report.abilities?.final ?? {}).map(([key, value]) => `${key}: ${value}`).join(', ')],
        ['Записи довідника', report.references]
    ];
    const {incompleteStages, unresolvedReferences, warnings} = report.diagnostics;
    const issues = [
        ...incompleteStages.map(row => `${row.label ?? row.stage}: ${Array.isArray(row.missing) ? row.missing.join(' ') : row.missing}`),
        ...unresolvedReferences.map(row => `Не знайдено: ${row.slug} (${row.path})`),
        ...warnings.map(row => `${row.path}: ${row.message}`)
    ];
    return `<p><strong>Експорт персонажа 1d20.</strong> Перевірте дані перед імпортом. До вибору дії аркуш не змінюється.</p>
        <table><tbody>${rows.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')}</tbody></table>
        <p>Незавершені кроки: ${incompleteStages.length}. Невідомі посилання: ${unresolvedReferences.length}. Попередження: ${warnings.length}.</p>
        ${issues.length ? `<ul>${issues.slice(0, 50).map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>` : '<p>За даними конструктора зауважень немає. Сумісність механік із Plutonium ще не перевірена.</p>'}`;
}

export async function previewCharacterExport(input, {actor = null} = {}) {
    const report = inspectCharacterExport(input);
    const {characterImportIssues, canPopulateCharacter, importCharacterExport} = await import('./character-import.js');
    const issues = characterImportIssues(input);
    const canPopulate = canPopulateCharacter(actor);
    // Ctrl+V prepares the concrete result first. The only confirmation is the
    // resulting report immediately before the world write.
    if (!issues.length) {
        await importCharacterExport(input, {actor: canPopulate ? actor : null});
        return report;
    }
    const content = characterPreviewHTML(input)
        + (issues.length ? `<p><strong>Імпорт поки недоступний:</strong></p><ul>${issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>`
            : '')
        + (actor ? `<p>${canPopulate ? `Буде заповнено порожній аркуш «${escape(actor.name)}». Його характеристики та біографію буде замінено даними експорту.` : `Аркуш «${escape(actor.name)}» не порожній або недоступний для запису. Можна створити нового персонажа.`}</p>` : '');
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error('Для перегляду потрібен DialogV2 у Foundry 13/14.');
    await DialogV2.wait({
        window: {title: '1d20 → Foundry: експорт персонажа'},
        position: {width: 660},
        content,
        buttons: [{action: 'close', label: 'Закрити', default: true}],
        rejectClose: false
    });
    return report;
}
