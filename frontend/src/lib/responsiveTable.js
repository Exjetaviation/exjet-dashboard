// Decide which columns become a phone card's title vs its meta line.
// columns: [{ key, label, render?, role?: 'title' | 'hide' }]
export function cardFields(columns) {
  const title = columns.find((c) => c.role === 'title') || columns[0];
  const meta = columns.filter((c) => c !== title && c.role !== 'hide');
  return { title, meta };
}
