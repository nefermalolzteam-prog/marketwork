import { hasExplicitAgeOrDateNearKeyword } from './search.js';

const testCases = [
  ['отлега от 30д wargaming', true],
  ['отлега 90d+', true],
  ['отлега от 30д', true],
  ['есть отлежка', false],
  ['inactive 1 year', true],
  ['отлега 2m', true],
];

console.log('Проверка новых паттернов:');
testCases.forEach(([text, expected]) => {
  const result = hasExplicitAgeOrDateNearKeyword(text);
  const status = result === expected ? '✅' : '❌';
  console.log(`${status} '${text}' → ${result} (ожидалось: ${expected})`);
});
