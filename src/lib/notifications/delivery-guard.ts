export type NotificationDeliveryOutcome<T> =
  | { status: "duplicate" }
  | { status: "sent"; result: T }
  | { status: "ambiguous"; error: unknown };

export async function deliverNotificationOnce<T>({
  claim,
  markAmbiguous,
  markSent,
  send,
}: {
  claim: () => Promise<boolean>;
  markAmbiguous: (error: unknown) => Promise<void>;
  markSent: (result: T) => Promise<void>;
  send: () => Promise<T>;
}): Promise<NotificationDeliveryOutcome<T>> {
  if (!(await claim())) return { status: "duplicate" };

  try {
    const result = await send();
    await markSent(result);
    return { status: "sent", result };
  } catch (error) {
    // Once delivery has been attempted, an error can mean the provider accepted
    // the message but its response was lost. Preserve the claim and never retry
    // this recipient/period automatically.
    await markAmbiguous(error).catch((markError) => {
      console.error("Unable to mark an ambiguous notification delivery.", markError);
    });
    return { status: "ambiguous", error };
  }
}
