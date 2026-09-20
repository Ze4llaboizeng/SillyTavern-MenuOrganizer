import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'window.__moTest = { ensureKeys, defaultLayout, applyLayout, persistEditor, normalizeExtensionEntry, dedupeBranches, compareBranchNames };})();');

function item(id) {
    const attrs = new Map();
    const element = {
        id,
        children: [],
        textContent: id,
        parentNode: null,
        dataset: {},
        style: { setProperty() {}, removeProperty() {} },
        getAttribute: name => attrs.get(name) || null,
        setAttribute: (name, value) => attrs.set(name, value),
        querySelector: () => null,
    };
    Object.defineProperty(element, 'nextSibling', { get() {
        if (!this.parentNode) return null;
        return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
    } });
    return element;
}

function column(...children) {
    const col = {
        children,
        insertBefore(node, ref) {
            if (node.parentNode) {
                const old = node.parentNode.children;
                old.splice(old.indexOf(node), 1);
            }
            const index = ref ? this.children.indexOf(ref) : this.children.length;
            this.children.splice(index, 0, node);
            node.parentNode = this;
        },
    };
    children.forEach(child => { child.parentNode = col; });
    return col;
}

const columns = {
    extensions_settings: column(item('a'), item('b')),
    extensions_settings2: column(item('c')),
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

const rightSaved = item('right-saved');
const newLeft = item('new-left');
const leftSaved = item('left-saved');
const newRight = item('new-right');
columns.extensions_settings = column(rightSaved, newLeft);
columns.extensions_settings2 = column(leftSaved, newRight);
window.SillyTavern = { getContext: () => ({ extensionSettings: { menuOrganizer: { profiles: { desktop: {
    layout: {
        extensions_settings: ['id:left-saved'],
        extensions_settings2: ['id:right-saved'],
    },
    hidden: [],
} } } } }) };
context.window.__moTest.applyLayout();
assert.deepEqual(columns.extensions_settings.children.map(element => element.id), ['left-saved', 'new-left']);
assert.deepEqual(columns.extensions_settings2.children.map(element => element.id), ['right-saved', 'new-right']);

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
