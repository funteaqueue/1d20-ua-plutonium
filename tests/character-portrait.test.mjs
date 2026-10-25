import test from 'node:test';
import assert from 'node:assert/strict';
import {importCharacterExport} from '../scripts/character-import.js';

const portrait = 'data:image/png;base64,AA==';
function setup({allow = true, upload, failImage = false, failReport = false} = {}) {
    const events = [], warnings = [], writes = [];
    const actor = {id: 'actor-id', name: 'Empty', type: 'character', isOwner: true, items: new Map(), effects: new Map(), flags: {},
        toObject: () => ({name: 'Empty', img: 'existing.png'}),
        sheet: {render: async () => events.push('render')},
        importFromJSON: async json => { events.push('commit'); writes.push(JSON.parse(json)); return actor; },
        update: async data => {
            if ('img' in data) { events.push('portrait'); if (failImage) throw new Error('Image rejected'); }
            else { events.push('report'); if (failReport) throw new Error('Report rejected'); }
            writes.push(data); return actor;
        }};
    globalThis.game = {user: {can: key => key !== 'FILES_UPLOAD' || allow}, world: {id: 'world-id'}};
    globalThis.ui = {notifications: {info() {}, warn: text => warnings.push(text)}};
    globalThis.CONFIG = {Actor: {documentClass: {create: async source => { events.push('commit'); writes.push(structuredClone(source)); return actor; }}}};
    globalThis.foundry = {utils: {randomID: () => 'random-id'}, applications: {
        api: {DialogV2: {wait: async () => { events.push('review'); return 'apply'; }}},
        apps: {FilePicker: {implementation: {upload: async (...args) => {
            events.push('upload');
            assert.equal(args[0], 'data'); assert.equal(args[1], 'worlds/world-id');
            assert.equal(args[2].name, '1d20-portrait-actor-id-random-id.png');
            assert.equal(args[2].type, 'image/png'); assert.equal(args[2].size, 1);
            return upload ? upload(...args) : {path: 'worlds/world-id/portrait.png'};
        }}}}
    }};
    const prepare = async () => ({source: {name: 'Imported', items: []}, portrait, notes: [], itemCount: 0, name: 'Imported'});
    return {actor, events, warnings, writes, prepare};
}
function teardown() { for (const key of ['game', 'ui', 'CONFIG', 'foundry']) delete globalThis[key]; }

test('portrait is uploaded and applied only after confirmation and character creation', async () => {
    const h = setup();
    try {
        assert.equal(await importCharacterExport({}, {prepare: h.prepare}), h.actor);
        assert.deepEqual(h.events, ['review', 'commit', 'render', 'upload', 'portrait']);
        assert.equal(h.writes[0].img, undefined);
        assert.equal(h.writes[1].img, 'worlds/world-id/portrait.png');
        assert.equal(h.warnings.length, 0);
    } finally { teardown(); }
});

test('denied uploads, server errors and portrait update errors never retry or fail the character commit', async () => {
    for (const options of [
        {allow: false}, {upload: () => false}, {upload: () => ({})},
        {upload: () => ({error: 'Forbidden', path: 'ignored.png'})},
        {upload: () => { throw new Error('Server offline'); }},
        {failImage: true}, {allow: false, failReport: true}
    ]) {
        const h = setup(options);
        try {
            assert.equal(await importCharacterExport({}, {actor: h.actor, prepare: h.prepare, review: false}), h.actor);
            assert.equal(h.events.filter(e => e === 'commit').length, 1);
            assert.equal(h.writes[0].img, 'existing.png');
            assert.equal(h.warnings.length, 1);
            if (options.allow === false) assert(!h.events.includes('upload'));
            if (!options.failReport) assert(h.writes.at(-1)['flags.1d20-ua-plutonium.characterImport.report.notes'].includes(h.warnings[0]));
        } finally { teardown(); }
    }
});

test('URL portraits need no file permission, while malformed embedded images only produce a warning', async () => {
    for (const image of ['https://example.com/portrait.webp', 'data:image/png;base64,broken!', 'blob:local']) {
        const h = setup({allow: false});
        try {
            await importCharacterExport({}, {review: false, prepare: async () => ({...await h.prepare(), portrait: image})});
            assert(!h.events.includes('upload'));
            assert.equal(h.warnings.length, image.startsWith('https:') ? 0 : 1);
            if (image.startsWith('https:')) assert.equal(h.writes[1].img, image);
        } finally { teardown(); }
    }
});

test('cancelled reviews and failed character commits do not upload or apply portraits', async () => {
    const h = setup();
    try {
        foundry.applications.api.DialogV2.wait = async () => 'cancel';
        assert.equal(await importCharacterExport({}, {prepare: h.prepare}), null);
        assert.deepEqual(h.events, []);
        CONFIG.Actor.documentClass.create = async () => { throw new Error('Commit failed'); };
        await assert.rejects(importCharacterExport({}, {prepare: h.prepare, review: false}), /Commit failed/);
        assert.deepEqual(h.events, []);
    } finally { teardown(); }
});
