import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__moTest = { ensureKeys, defaultLayout, persistEditor, normalizeExtensionEntry, dedupeBranches, compareBranchNames };})();');

function item(id) {
    const attrs = new Map();
    return {
        id,
        children: [],
        textContent: id,
        getAttribute: name => attrs.get(name) || null,
        setAttribute: (name, value) => attrs.set(name, value),
        querySelector: () => null,
    };
}

const columns = {
    extensions_settings: { children: [item('a'), item('b')] },
    extensions_settings2: { children: [item('c')] },
};
const window = { addEventListener() {} };
const context = {
    window,
    document: {
        addEventListener() {},
        getElementById: id => columns[id] || null,
    },
};

vm.runInNewContext(source, context);
context.window.__moTest.ensureKeys();
assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.__moTest.defaultLayout)),
    { extensions_settings: ['id:a', 'id:b'], extensions_settings2: ['id:c'] },
);

columns.extensions_settings.children = [columns.extensions_settings2.children[0]];
columns.extensions_settings2.children = [];
context.window.__moTest.ensureKeys();
assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.__moTest.defaultLayout)),
    { extensions_settings: ['id:a', 'id:b'], extensions_settings2: ['id:c'] },
);

const settings = {
    layout: { extensions_settings: ['old-a'], extensions_settings2: ['old-b'] },
    hidden: [],
};
const rows = ['id:a', 'id:c'].map(key => ({
    getAttribute: () => key,
    classList: { contains: () => key === 'id:c' },
}));
const mobileList = {
    attr: () => 'extensions_settings',
    find: () => ({ each: callback => rows.forEach(row => callback.call(row)) }),
};
context.window.__moTest.persistEditor([mobileList], settings);
assert.deepEqual(JSON.parse(JSON.stringify(settings)), {
    layout: { extensions_settings: ['id:a', 'id:c'], extensions_settings2: [] },
    hidden: ['id:c'],
});

assert.equal(context.window.__moTest.normalizeExtensionEntry({ type: 'system', name: 'caption' }), null);
assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.__moTest.normalizeExtensionEntry({ type: 'global', name: 'third-party/Quick-Reply' }))),
    {
        id: 'global:Quick-Reply',
        extensionName: 'Quick-Reply',
        internalName: 'third-party/Quick-Reply',
        global: true,
        type: 'global',
    },
);

const branches = context.window.__moTest.dedupeBranches([
    { name: 'origin/v1.9.0', current: false, commit: 'remote-old' },
    { name: 'v1.9.0', current: true, commit: 'local-old' },
    { name: 'origin/v2.1.0', current: false, commit: 'remote-new' },
    { name: 'origin/main', current: false, commit: 'main' },
    { name: 'origin/HEAD', current: false, commit: 'head' },
]);
assert.deepEqual(JSON.parse(JSON.stringify(branches.map(branch => [branch.name, branch.shortName, branch.current]))), [
    ['origin/v2.1.0', 'v2.1.0', false],
    ['v1.9.0', 'v1.9.0', true],
    ['origin/main', 'main', false],
]);

console.log('Menu Organizer self-check passed');
