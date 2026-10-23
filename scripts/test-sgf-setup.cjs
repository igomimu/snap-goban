const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    }});
    module._compile(result.outputText, filename);
};
const { parseSGFTree } = require(process.env.SGF_UTILS_PATH || '../src/utils/sgfUtils.ts');
const count = board => board.flat().reduce((counts, stone) => {
    if (stone) counts[stone.color]++;
    return counts;
}, { BLACK: 0, WHITE: 0 });

// The reported MultiGo file wraps both setup lists and repeats AB after SZ.
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/multigo-wrapped-setup.sgf'), 'utf8');
for (const content of [fixture, fixture.replace(/\r?\n/g, ''), fixture.replace(/\r?\n/g, '\r\n\t ')]) {
    const parsed = parseSGFTree(content);
    assert.equal(parsed.size, 19);
    assert.deepEqual(count(parsed.board), { BLACK: 64, WHITE: 48 });
    assert.equal(parsed.board[2][3].color, 'BLACK', 'Repeated AB[dc] must be included');
    const moves = [];
    let node = parsed.root;
    while (node.children.length) {
        assert.equal(node.children.length, 1);
        node = node.children[0];
        if (node.move) moves.push(node.move);
    }
    assert.equal(moves.length, 33);
    assert.deepEqual(moves.flatMap((move, index) => move.x === 0 && move.y === 0 ? [index + 1] : []), [4, 12, 22]);
    assert.deepEqual(moves[0], { x: 15, y: 2, color: 'BLACK' });
}

// Descendant setup and property-looking text in comments must not leak into root.
const scoped = parseSGFTree('(;SZ[9]C[ignore AB[hh\\] ; (text)]AB [aa]\n\t[bb]AW\n[cc]\t[dd]AB[ee];B[ff]AB[gg])');
assert.deepEqual(count(scoped.board), { BLACK: 3, WHITE: 2 });
assert.equal(scoped.board[6][6], null);
assert.equal(scoped.board[7][7], null);
assert.deepEqual(scoped.root.children[0].move, { x: 6, y: 6, color: 'BLACK' });

const branchOnly = parseSGFTree('(;SZ[9](;AB[aa];B[bb])(;AW[cc];W[dd]))');
assert.deepEqual(count(branchOnly.board), { BLACK: 0, WHITE: 0 });
assert.equal(branchOnly.root.children.length, 2);
assert.deepEqual(count(parseSGFTree('(;SZ[9]AB[aa][bb]AW[cc])').board), { BLACK: 2, WHITE: 1 });
console.log('PASS: MultiGo setup (64 black/48 white), whitespace, repeated properties, root isolation, comments and 33 moves/passes');
