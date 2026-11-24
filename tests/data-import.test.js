const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
    return {
        value: '',
        innerHTML: '',
        textContent: '',
        style: {},
        classList: {
            add() {},
            remove() {},
            contains() { return false; }
        },
        listeners: {},
        addEventListener(event, callback) {
            this.listeners[event] = callback;
        },
        appendChild() {},
        querySelector() { return createElement(); },
        querySelectorAll() { return []; }
    };
}

async function importFixture(files) {
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };

    let savedDb;
    const document = {
        getElementById: getElement,
        querySelector() { return createElement(); },
        querySelectorAll() { return []; },
        createElement,
        createDocumentFragment: createElement,
        addEventListener() {}
    };

    const context = {
        document,
        window: {},
        navigator: { clipboard: { writeText: async () => {} } },
        localforage: {
            getItem: async () => null,
            setItem: async (_key, value) => { savedDb = value; }
        },
        Papa: {
            parse(file, options) {
                options.complete({ data: file.rows });
            }
        },
        Intl,
        Map,
        Promise,
        console,
        setTimeout,
        alert() {}
    };

    const appPath = path.join(__dirname, '..', 'app.js');
    vm.runInNewContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });

    await getElement('folderInput').listeners.change({ target: { files } });
    return savedDb;
}

async function loadRegressionFixture() {
    const files = [
        {
            name: 'PRACTICAS.csv',
            webkitRelativePath: 'CONVENIOS/Prestador/PRACTICAS.csv',
            rows: [
                { prestac: '777', deno: 'Práctica ambulatoria', ambu_inter: 'A' },
                { prestac: '777', deno: 'Práctica internación', ambu_inter: 'I' },
                { prestac: '00123', deno: 'Código con ceros', ambu_inter: 'A' },
                { prestac: '123', deno: 'Código sin ceros', ambu_inter: 'A' }
            ]
        },
        {
            name: 'NORMAS.csv',
            webkitRelativePath: 'CONVENIOS/Prestador/NORMAS.csv',
            rows: [
                { prestac: '00123', inclu: 'Norma del código 00123' },
                { prestac: '123', inclu: 'Norma del código 123' }
            ]
        }
    ];

    return importFixture(files);
}

test('conserva todos los registros que comparten el mismo código', async () => {
    const db = await loadRegressionFixture();
    const practices = db.practices.Prestador;

    assert.equal(
        practices.filter((practice) => practice.prestac === '777').length,
        2,
        'debe conservar todos los registros que comparten el mismo código'
    );
});

test('asigna cada norma al código exacto que le corresponde', async () => {
    const db = await loadRegressionFixture();

    assert.equal(db.normas.Prestador['00123'].inclu, 'Norma del código 00123');
    assert.equal(db.normas.Prestador['123'].inclu, 'Norma del código 123');
});
