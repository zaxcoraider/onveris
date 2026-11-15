// Decides what to do with the differences found by a check. Pure logic, no storage or network,
// so it can be tested on its own.
//
//   differences    fields where the chain differs from the record ({ field, recorded, onChain })
//   openChanges    unreconciled Change records for the contract
//   plannedChanges open PlannedChange records for the contract
//
// Returns:
//   create  differences seen for the first time, each with the planned change that announced it, if any
//   update  open changes whose value on the chain has moved again
//   keep    open changes that still stand as they are
//   clear   open changes whose field matches the record again
export function decide(differences, openChanges, plannedChanges) {
  const result = { create: [], update: [], keep: [], clear: [] };
  const openByField = new Map(openChanges.map((change) => [change.field, change]));

  for (const difference of differences) {
    const open = openByField.get(difference.field);
    if (open) {
      openByField.delete(difference.field);
      if (open.newValue === difference.onChain) result.keep.push(open);
      else result.update.push({ change: open, newValue: difference.onChain });
      continue;
    }
    const planned =
      plannedChanges.find(
        (plan) =>
          plan.field === difference.field && (!plan.expectedValue || plan.expectedValue === difference.onChain)
      ) || null;
    result.create.push({ difference, planned });
  }

  result.clear.push(...openByField.values());
  return result;
}
