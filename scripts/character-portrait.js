/** Optional artwork step, called only after the character has been committed. */
export async function applyCharacterPortrait(actor, portrait) {
    if (!portrait) return;
    if (typeof portrait !== 'string') throw new Error('Unsupported portrait format');
    let path = portrait;
    if (!/^https?:\/\//i.test(portrait)) {
        const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(portrait);
        if (!match) throw new Error('Unsupported portrait format');
        if (!game.user.can('FILES_UPLOAD')) throw new Error('File uploads are not permitted');
        const picker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation;
        if (!picker?.upload || !game.world?.id) throw new Error('File storage is unavailable');
        const binary = atob(match[2].replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const extension = match[1].toLowerCase();
        const file = new File([bytes], `1d20-portrait-${actor.id}-${foundry.utils.randomID()}.${extension}`, {type: `image/${extension}`});
        // Use the active FilePicker implementation so hosting integrations and
        // server permissions apply. No alternative upload on a denied request.
        const uploaded = await picker.upload('data', `worlds/${game.world.id}`, file, {}, {notify: false});
        if (!uploaded || uploaded.error || typeof uploaded.path !== 'string' || !uploaded.path) throw new Error('Portrait upload failed');
        path = uploaded.path;
    }
    const updated = await actor.update({img: path});
    if (!updated) throw new Error('Portrait update was rejected');
}
