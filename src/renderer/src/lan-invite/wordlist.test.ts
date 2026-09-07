import { describe, it, expect } from 'vitest';
import { ADJECTIVES, NOUNS } from './wordlist.js';

/**
 * Categories the lists must not contain. A name is two words shown to
 * strangers, and nobody reviews the 65,536 pairings before someone reads one,
 * so safety has to come from the words rather than from the combinations.
 */
const FORBIDDEN = [
  // animals: an adjective in front of one is how a pairing lands as an insult
  'ape',
  'bear',
  'bird',
  'cat',
  'dog',
  'fish',
  'fox',
  'goat',
  'monkey',
  'mouse',
  'ox',
  'pig',
  'rat',
  'snake',
  'wolf',
  'viper',
  'barnacle',
  'marmoset',
  // people and roles: the other shape that lands as an insult
  'baron',
  'boy',
  'chef',
  'father',
  'girl',
  'king',
  'lady',
  'man',
  'master',
  'mother',
  'nurse',
  'priest',
  'queen',
  'servant',
  'slave',
  'thief',
  'witch',
  'woman',
  // bodies
  'arm',
  'beard',
  'bone',
  'chest',
  'ear',
  'eye',
  'face',
  'hair',
  'hip',
  'jaw',
  'knee',
  'leg',
  'mouth',
  'muscle',
  'nose',
  'skin',
  'teeth',
  'thumb',
  // colours, including the ones wearing a fruit's name
  'amber',
  'black',
  'blue',
  'brown',
  'cream',
  'gold',
  'green',
  'grey',
  'ivory',
  'olive',
  'orange',
  'pink',
  'purple',
  'red',
  'silver',
  'tan',
  'violet',
  'white',
  'yellow',
  // nations, faiths, conflict, health
  'arab',
  'asian',
  'english',
  'french',
  'jew',
  'native',
  'church',
  'cross',
  'mosque',
  'temple',
  'blood',
  'gun',
  'kill',
  'war',
  'weapon',
  'dead',
  'sick',
  'fat',
  'ugly',
];

describe.each([
  ['adjectives', ADJECTIVES],
  ['nouns', NOUNS],
])('%s', (_name, words) => {
  it('holds exactly 256 entries, so a name takes one byte per half', () => {
    expect(words.length).toBe(256);
  });

  it('holds only lowercase ascii words of a speakable length', () => {
    for (const word of words) expect(word).toMatch(/^[a-z]{3,9}$/);
  });

  it('has no duplicates', () => {
    expect(new Set(words).size).toBe(words.length);
  });

  it('contains nothing from a category that pairs badly', () => {
    const found = words.filter((word) => FORBIDDEN.includes(word));
    expect(found).toEqual([]);
  });
});

describe('the two lists together', () => {
  it('share no word, so a name cannot read as the same word twice', () => {
    const shared = ADJECTIVES.filter((word) => NOUNS.includes(word));
    expect(shared).toEqual([]);
  });
});
