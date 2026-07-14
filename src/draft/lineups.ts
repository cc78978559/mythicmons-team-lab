export function chooseK<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 0) throw new Error("Lineup size must be a non-negative integer");
  if (values.length < size) return [];
  if (values.length === size) return [[...values]];
  const result: T[][] = [];
  const current: T[] = [];
  const visit = (start: number) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    const needed = size - current.length;
    for (let index = start; index <= values.length - needed; index += 1) {
      current.push(values[index]);
      visit(index + 1);
      current.pop();
    }
  };
  visit(0);
  return result;
}

export function assertBattleLineup<T>(lineup: readonly T[], managerId: string): void {
  if (lineup.length !== 6) throw new Error(`${managerId} produced an illegal ${lineup.length}-member battle lineup`);
}
