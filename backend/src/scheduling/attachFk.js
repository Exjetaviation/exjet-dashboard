// backend/src/scheduling/attachFk.js
//
// Pure: inject a resolved uuid foreign key into each mapped child record's
// `values`, after its parent has been upserted. Records whose parent id is
// unknown (parent wasn't upserted) are dropped — they'd violate the FK.
// Does not mutate the input.

// records: Array<{ lfOid, values, snapshot, ref }>
// fkColumn: the column to set (e.g. 'trip_id')
// refOf: (record) => parentLfOid
// idByLfOid: Map<parentLfOid, uuid>
// returns: a new array of records with values[fkColumn] set
export function attachFk(records, fkColumn, refOf, idByLfOid) {
  const out = [];
  for (const rec of records) {
    const id = idByLfOid.get(refOf(rec));
    if (!id) continue;
    out.push({ ...rec, values: { ...rec.values, [fkColumn]: id } });
  }
  return out;
}
