import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__moTest = { ensureKeys, defaultLayout };})();');

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

console.log('Menu Organizer self-check passed');
