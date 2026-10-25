import {ABILITIES, array, unique} from './character-plan.js';

function spellUses(count) {
    if (['pb', 'pbe'].includes(count)) return '@attributes.prof';
    if (['halfPb', 'halfPbe'].includes(count)) return 'floor(@attributes.prof / 2)';
    if (count === 'mod') return 'max(1, @attributes.spell.mod)';
    if (ABILITIES.includes(count)) return `max(1, @abilities.${count}.mod)`;
    if (/^\d+e?$/.test(count)) return parseInt(count, 10);
    throw new Error(`Невідомий ліміт застосувань закляття: ${count}.`);
}

/** Decode the official 5etools additionalSpells grammar, including its PHB UID default. */
export function additionalSpellRules(entity) {
    const out = [];
    for (const [blockIndex, block] of array(entity.additionalSpells).entries()) {
        const push = (entry, meta) => {
            if (typeof entry === 'string') {
                const [uid, castAt] = entry.split('#');
                const [name, source = 'PHB'] = uid.split('|');
                out.push({...meta, name: name.toLowerCase(), source: source.toLowerCase(), castAt: /^\d+$/.test(castAt) ? Number(castAt) : null});
            } else if (entry?.choose?.from) for (const uid of entry.choose.from) push(uid, meta);
            else if (typeof entry?.choose === 'string' || typeof entry?.all === 'string') out.push({...meta, filter: entry.choose ?? entry.all});
        };
        for (const kind of ['known', 'prepared', 'innate']) {
            for (const [level, value] of Object.entries(block[kind] ?? {})) {
                const base = {blockIndex, blockName: block.name, ability: block.ability, kind,
                    requiredLevel: /^\d+$/.test(level) ? Number(level) : 0, method: kind === 'innate' ? 'innate' : 'spell', prepared: kind === 'prepared' ? 2 : 1};
                if (Array.isArray(value)) value.forEach(entry => push(entry, base));
                else for (const [recharge, values] of Object.entries(value ?? {})) {
                    if (['daily', 'rest', 'limited'].includes(recharge)) {
                        for (const [count, entries] of Object.entries(values)) for (const entry of array(entries)) push(entry, {...base, method: 'innate', prepared: 2, uses: spellUses(count), period: recharge === 'rest' ? 'sr' : recharge === 'daily' ? 'lr' : null});
                    } else if (['will', 'ritual', '_'].includes(recharge)) {
                        for (const entry of array(values)) push(entry, {...base, method: recharge === 'ritual' ? 'ritual' : recharge === 'will' ? 'atwill' : base.method});
                    } else if (recharge === 'resource') {
                        for (const [amount, entries] of Object.entries(values)) for (const entry of array(entries)) push(entry, {...base, method: 'innate', resourceName: block.resourceName, resourceAmount: Number(amount)});
                    }
                }
            }
        }
    }
    return out;
}

function filterMatches(filter, spell) {
    // A selected spell already passed the builder's class/school filters. Level is
    // needed here to distinguish a feat's free 1st-level cast from its cantrips.
    const level = /(?:^|\|)level=([^|]+)/i.exec(filter)?.[1];
    if (level && !level.split(/[;,]/).map(Number).includes(Number(spell.level))) return false;
    const school = /(?:^|\|)school=([^|]+)/i.exec(filter)?.[1];
    if (school && !school.toLowerCase().split(/[;,]/).includes(String(spell.school).toLowerCase())) return false;
    return true;
}

export function findSpellGrant(row, spell, owners, level, lineage) {
    const candidates = [];
    for (const owner of owners) {
        if (row.kind === 'race' && owner.prop !== 'race') continue;
        if (row.kind === 'feat' && !['feat', 'optionalfeature', 'background'].includes(owner.prop)) continue;
        if (row.kind === 'subclass' && owner.classSlug !== row.classSlug) continue;
        if (['class', 'arcanum'].includes(row.kind)) continue;
        for (const rule of additionalSpellRules(owner.entity)) {
            if (rule.requiredLevel > level) continue;
            if (owner.prop === 'race' && lineage?.name_en && rule.blockName && rule.blockName.toLowerCase() !== lineage.name_en.toLowerCase()) continue;
            if (row.ability && typeof rule.ability === 'string' && ABILITIES.includes(rule.ability) && row.ability !== rule.ability) continue;
            if (rule.filter ? !filterMatches(rule.filter, spell) : rule.name !== spell.name.toLowerCase() || rule.source !== spell.source.toLowerCase()) continue;
            candidates.push({...rule, owner});
        }
    }
    const exact = candidates.filter(rule => !rule.filter);
    const matches = exact.length ? exact : candidates;
    if (!matches.length) return null;
    const signatures = unique(matches.map(rule => JSON.stringify([rule.method, rule.prepared, row.ability ?? rule.ability, rule.uses, rule.period, rule.castAt, rule.resourceName, rule.resourceAmount])));
    if (signatures.length > 1) throw new Error(`Неоднозначні умови отримання закляття «${spell.name}» (${row.origin}). Потрібен вибір джерела у конструкторі.`);
    return matches[0];
}

export async function characterSpellAbility(row, cls, grant, chooseAbility) {
    let ability = row.ability;
    if (!ABILITIES.includes(ability)) ability = typeof grant?.ability === 'string' ? grant.ability : null;
    if (!ABILITIES.includes(ability) && ['class', 'subclass', 'arcanum'].includes(row.kind)) ability = cls?.entity?.spellcastingAbility ?? cls?.subclass?.spellcastingAbility;
    if (!ABILITIES.includes(ability)) {
        const choices = array(grant?.ability?.choose).filter(key => ABILITIES.includes(key));
        ability = await chooseAbility({key: row.origin, label: row.src || row.origin, choices: choices.length ? choices : ['int', 'wis', 'cha']});
        if (!ABILITIES.includes(ability) || (choices.length && !choices.includes(ability))) throw new Error(`Не вибрано характеристику заклять: ${row.origin}.`);
    }
    return ability;
}

export async function configureCharacterSpell(item, row, spell, {cls, grant, chooseAbility, report, resourceItems = []}) {
    item.system.ability = await characterSpellAbility(row, cls, grant, chooseAbility);
    const sourceItem = ['class', 'subclass', 'arcanum'].includes(row.kind) ? cls?.item : grant?.owner?.item;
    item.system.sourceItem = sourceItem?.system.identifier ? `${sourceItem.type ?? (cls ? 'class' : 'feat')}:${sourceItem.system.identifier}` : '';
    item.system.method = grant?.method ?? (row.kind === 'arcanum' ? 'innate' : cls?.entity?.casterProgression === 'pact' ? 'pact' : ['race', 'feat'].includes(row.kind) ? 'innate' : 'spell');
    item.system.prepared = spell.level === 0 ? 2 : grant?.prepared ?? (row.prep === false ? 0 : 1);
    if (!grant && ['race', 'feat'].includes(row.kind) && spell.level > 0) report.push(`Для «${spell.name}» немає умов витрачання ресурсу в Plutonium. Перевірте ліміт застосувань у його описі.`);
    const uses = row.kind === 'arcanum' ? 1 : grant?.uses;
    const period = row.kind === 'arcanum' ? 'lr' : grant?.period;
    if (uses) {
        item.system.uses = {spent: 0, max: String(uses), recovery: period ? [{period, type: 'recoverAll'}] : []};
        for (const activity of Object.values(item.system.activities ?? {})) {
            activity.consumption = {...activity.consumption, spellSlot: false, targets: [{type: 'itemUses', target: '', value: '1', scaling: {mode: ''}}]};
        }
        if (row.kind !== 'arcanum') report.push('Безкоштовні застосування заклять мають власні ліміти. Якщо опис також дозволяє накладання за звичайну комірку, перевірте цей спосіб витрачання в дії закляття.');
    } else if (['innate', 'atwill', 'ritual'].includes(item.system.method) || spell.level === 0) {
        for (const activity of Object.values(item.system.activities ?? {})) if (activity.consumption) activity.consumption.spellSlot = false;
    }
    if (grant?.castAt && grant.castAt > spell.level) {
        report.push(`«${spell.name}»: Plutonium отримав вроджене застосування на ${grant.castAt}-му колі. Перевірте масштабування дії.`);
    }
    if (grant?.resourceName) {
        const matches = resourceItems.filter(owner => owner.entity.name.toLowerCase() === grant.resourceName.toLowerCase() && owner.item.system.uses?.max);
        if (matches.length === 1) for (const activity of Object.values(item.system.activities ?? {})) {
            activity.consumption = {...activity.consumption, spellSlot: false, targets: [{type: 'itemUses', target: matches[0].item._id, value: String(grant.resourceAmount), scaling: {mode: ''}}]};
        }
        else report.push(`«${spell.name}» використовує ресурс «${grant.resourceName}»; зв'язок витрачання потребує перевірки.`);
    }
    item.flags ??= {};
    item.flags['1d20-ua-plutonium'] = {...item.flags['1d20-ua-plutonium'], spellOrigin: {origin: row.origin, classSlug: row.classSlug, kind: row.kind, castAt: grant?.castAt ?? null}};
}
