import { type FormEvent, useCallback, useEffect, useRef } from "react";

export function useFormDraft(key: string) {
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const rawDraft = localStorage.getItem(key);

    if (!rawDraft) {
      return;
    }

    try {
      const draft = JSON.parse(rawDraft) as Record<string, string>;

      for (const [name, value] of Object.entries(draft)) {
        const field = form.elements.namedItem(name);

        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement ||
          field instanceof HTMLTextAreaElement
        ) {
          if (field instanceof HTMLInputElement && field.type === "file") {
            continue;
          }

          field.value = value;
        }
      }
    } catch {
      localStorage.removeItem(key);
    }
  }, [key]);

  const saveDraft = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const draft: Record<string, string> = {};

      for (const [name, value] of formData.entries()) {
        if (typeof value === "string") {
          draft[name] = value;
        }
      }

      localStorage.setItem(key, JSON.stringify(draft));
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
  }, [key]);

  return {
    clearDraft,
    formRef,
    saveDraft
  };
}
