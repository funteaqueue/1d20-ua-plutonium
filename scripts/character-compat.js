/** dnd5e 5.3 (Foundry 13) and 6.x (Foundry 14) share item/advancement schemas,
 * but store actor armour calculations differently. */
export function characterSystemMajor(version) {
    const [major, minor] = String(version).split('.').map(Number);
    if (major === 6 || (major === 5 && minor === 3)) return major;
    throw new Error('Імпорт потребує dnd5e 5.3.x (Foundry 13) або 6.x (Foundry 14).');
}

export function initialCharacterArmor(major, classNames, hasArmor) {
    const calcs = classNames.map(name => ({Monk: 'unarmoredMonk', Barbarian: 'unarmoredBarb'})[name]).filter(Boolean);
    if (major === 5) return {calc: !hasArmor && calcs.length === 1 ? calcs[0] : 'default'};
    return {calcs: ['unarmored', 'armored', ...calcs]};
}

export function overrideCharacterArmor(source, expected, major) {
    if (major === 5) {
        // 5.3's flat calculation returns before applying shield/effect bonuses.
        source.calc = 'flat';
        source.flat = expected;
    } else source.override = expected;
}
