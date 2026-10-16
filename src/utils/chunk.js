// src/utils/chunk.js
// Splits a list into pieces of at most `size` -- for requests that carry a list
// of ids in the URL (a long one is rejected as "Bad Request").
export function chunk(list, size) {
  const pieces = [];
  for (let i = 0; i < list.length; i += size) pieces.push(list.slice(i, i + size));
  return pieces;
}
