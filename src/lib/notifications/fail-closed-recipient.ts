export async function loadRecipientDataFailClosed<T>({
  load,
  process,
}: {
  load: () => Promise<T>;
  process: (data: T) => Promise<void>;
}) {
  try {
    const data = await load();
    await process(data);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error };
  }
}
