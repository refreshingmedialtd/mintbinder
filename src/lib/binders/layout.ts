const MAX_BINDER_PAGES = 100;
const SLOTS_PER_PAGE = 9;

export type BinderLayoutInput = {
  pages?: Array<{
    position?: unknown;
    slots?: Array<{
      collectionItemId?: unknown;
      copyIndex?: unknown;
      note?: unknown;
      position?: unknown;
    }>;
  }>;
};

export class BinderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinderInputError";
  }
}

export function normalizeBinderLayout(input: BinderLayoutInput) {
  if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > MAX_BINDER_PAGES) {
    throw new BinderInputError(`A binder must contain between 1 and ${MAX_BINDER_PAGES} pages.`);
  }

  return input.pages.map((page, pageIndex) => {
    if (page.position !== pageIndex) {
      throw new BinderInputError("Binder page positions must be contiguous and start at zero.");
    }

    if (!Array.isArray(page.slots) || page.slots.length !== SLOTS_PER_PAGE) {
      throw new BinderInputError(`Each binder page must contain exactly ${SLOTS_PER_PAGE} pockets.`);
    }

    return {
      position: pageIndex,
      slots: page.slots.map((slot, slotIndex) => {
        if (slot.position !== slotIndex) {
          throw new BinderInputError("Binder pocket positions must be contiguous and start at zero.");
        }

        const collectionItemId = optionalUuid(slot.collectionItemId);
        const copyIndex = collectionItemId ? positiveInteger(slot.copyIndex, "Copy number") : null;

        return {
          position: slotIndex,
          collectionItemId,
          copyIndex,
          note: optionalText(slot.note, 240),
        };
      }),
    };
  });
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";

  if (text.length > maxLength) throw new BinderInputError(`Text must be ${maxLength} characters or fewer.`);

  return text || null;
}

function optionalUuid(value: unknown) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BinderInputError("Binder pocket item ID is invalid.");
  }

  return value;
}

function positiveInteger(value: unknown, label: string) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new BinderInputError(`${label} must be a positive whole number.`);
  }

  return number;
}
