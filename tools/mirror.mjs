#!/usr/bin/env node
/**
 * Refresh the 1d20.com.ua data bundled with this module.
 *
 *   node tools/mirror.mjs [targetDir]
 *
 * targetDir defaults to the module's own data/ folder, which the module reads by
 * default (served by Foundry at modules/1d20-ua-plutonium/data/). Only the files the
 * module actually uses are fetched: the translation packs for the types it
 * translates, plus the bestiary catalogue index used to resolve 1d20 creature links.
 *
 * Files whose sha1 already matches the live manifest are skipped; every download is
 * verified against the manifest's sha1. A trimmed manifest listing just the bundled
 * files is written last.
 *
 * Safety: a local pack that carries full translated text (entries with "html") is
 * never overwritten by a live pack that only carries summaries — the site switched
 * to such a format on 2026-09-18. Pass --force to overwrite anyway.
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BASE = 'https://1d20.com.ua/wp-json/dnd/v1/data';
const UK_TYPES = ['spells', 'items', 'feats', 'optionalfeatures', 'backgrounds', 'races', 'classfeatures', 'subclassfeatures'];
const INDEX_TYPES = ['bestiary'];

const args = process.argv.slice(2);
const force = args.includes('--force');
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(args.find(a => !a.startsWith('--')) ?? join(here, '..', 'data'));

// Accept a bare key or a single KEY=value line. Never include it in URLs or logs.
let partnerKey = (await readLocal(join(here, '..', '.env')))?.toString('utf8').trim() ?? '';
if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(partnerKey)) {
    partnerKey = partnerKey.slice(partnerKey.indexOf('=') + 1).trim();
}
partnerKey = partnerKey.replace(/^(['"])(.*)\1$/, '$2');
if (!partnerKey || /[\r\n]/.test(partnerKey)) throw new Error('Expected a single partner key in the module .env file.');

function hasFullText(buffer) {
    try {
        const pack = JSON.parse(buffer.toString('utf8'));
        return (pack.entries ?? []).some(e => e?.html && Object.keys(e.html).length);
    } catch {
        return false;
    }
}

async function readLocal(path) {
    try {
        return await readFile(path);
    } catch {
        return null;
    }
}

function sha1(buffer) {
    return createHash('sha1').update(buffer).digest('hex');
}

async function download(url) {
    const response = await fetch(url, {
        headers: {Authorization: `Bearer ${partnerKey}`},
        redirect: 'error'
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

const manifest = JSON.parse((await download(`${BASE}/manifest.json`)).toString('utf8'));
console.log(`1d20 data version ${manifest.version} (${manifest.generated_at}) -> ${target}`);

const previous = JSON.parse((await readLocal(join(target, 'manifest.json')))?.toString('utf8') ?? 'null');
const kept = {uk: {}, index: {}};
const wanted = [
    ...UK_TYPES.map(type => ['uk', type]),
    ...INDEX_TYPES.map(type => ['index', type])
];

let downloaded = 0;
let skipped = 0;
for (const [section, type] of wanted) {
    const meta = manifest[section]?.[type];
    if (!meta) {
        throw new Error(`${section}/${type}: missing from the live manifest`);
    }
    if (meta.file !== `${section}/${type}.json`) throw new Error(`Unexpected file path for ${section}/${type}`);
    const path = join(target, meta.file);
    const local = await readLocal(path);
    if (local && sha1(local) === meta.sha1) {
        skipped++;
        kept[section][type] = meta;
        continue;
    }
    process.stdout.write(`  ${section}/${type} (${(meta.bytes / 1048576).toFixed(1)} MB)... `);
    const buffer = await download(`${BASE}/${meta.file}`);
    const actual = sha1(buffer);
    if (actual !== meta.sha1) throw new Error(`sha1 mismatch for ${meta.file}: expected ${meta.sha1}, got ${actual}`);
    const pack = JSON.parse(buffer.toString('utf8'));
    const entries = section === 'index' && Array.isArray(pack) ? pack : pack.entries;
    if (!Array.isArray(entries) || entries.length !== meta.count) {
        throw new Error(`Unexpected entry count or structure for ${meta.file}`);
    }
    if (section === 'uk' && local && hasFullText(local) && !hasFullText(buffer) && !force) {
        console.log('SKIPPED: live pack has summaries only, local pack has full text (use --force to overwrite)');
        kept[section][type] = previous?.[section]?.[type] ?? {...meta, sha1: sha1(local), bytes: local.length};
        continue;
    }
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, buffer);
    downloaded++;
    kept[section][type] = meta;
    console.log('ok');
}

const trimmed = {...manifest, uk: kept.uk, index: kept.index};
await mkdir(target, {recursive: true});
await writeFile(join(target, 'manifest.json'), `${JSON.stringify(trimmed, null, 2)}\n`);
console.log(`Done: ${downloaded} downloaded, ${skipped} up to date.`);
