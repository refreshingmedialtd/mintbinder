export async function runSerialTasks(tasks) {
  const results = [];

  for (const task of tasks) {
    results.push(await task());
  }

  return results;
}
