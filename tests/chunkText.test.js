const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkText } = require('../lib/chunkText');

test('texte vide renvoie un tableau vide', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   '), []);
});

test('texte court tient dans un seul chunk', () => {
  const result = chunkText('Bonjour le monde.', 100);
  assert.deepEqual(result, ['Bonjour le monde.']);
});

test('découpe aux frontières de paragraphe', () => {
  const p1 = 'A'.repeat(50);
  const p2 = 'B'.repeat(50);
  const text = `${p1}\n\n${p2}`;
  const result = chunkText(text, 60);
  assert.equal(result.length, 2);
  assert.equal(result[0], p1);
  assert.equal(result[1], p2);
});

test('paragraphe trop long est découpé par phrase', () => {
  const s1 = 'Ceci est la première phrase.';
  const s2 = 'Voici la seconde phrase qui suit.';
  const s3 = 'Et enfin une troisième phrase ici.';
  const text = `${s1} ${s2} ${s3}`;
  const result = chunkText(text, 40);
  assert.ok(result.length >= 2);
  for (const chunk of result) {
    assert.ok(chunk.length <= 40, `chunk trop long: "${chunk}" (${chunk.length})`);
  }
  assert.equal(result.join(' '), text);
});

test('texte sans ponctuation est découpé par mots sans les couper', () => {
  const words = Array.from({ length: 30 }, (_, i) => `mot${i}`);
  const text = words.join(' ');
  const result = chunkText(text, 20);
  for (const chunk of result) {
    assert.ok(chunk.length <= 20, `chunk trop long: "${chunk}"`);
    // aucun mot ne doit être coupé en deux (chaque chunk ne contient que des mots entiers)
    for (const w of chunk.split(' ')) {
      assert.ok(words.includes(w) || w === '', `mot inattendu/coupé: "${w}"`);
    }
  }
});

test('rejette les entrées invalides', () => {
  assert.throws(() => chunkText(42), TypeError);
  assert.throws(() => chunkText('abc', 0), RangeError);
});
