type AsyncTask<T> = () => Promise<T>;

export async function runSerialTasks<
  const Tasks extends readonly AsyncTask<unknown>[],
>(tasks: Tasks): Promise<{
  -readonly [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>;
}> {
  const results: unknown[] = [];

  for (const task of tasks) {
    results.push(await task());
  }

  return results as {
    -readonly [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>;
  };
}
