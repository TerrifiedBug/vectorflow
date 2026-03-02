import { create } from "zustand";

interface FormStoreState {
  /** formId → fieldName → value */
  fields: Record<string, Record<string, unknown>>;
  setField: (formId: string, field: string, value: unknown) => void;
  getField: <T>(formId: string, field: string) => T | undefined;
  clearForm: (formId: string) => void;
}

export const useFormStore = create<FormStoreState>((set, get) => ({
  fields: {},

  setField: (formId, field, value) =>
    set((state) => ({
      fields: {
        ...state.fields,
        [formId]: {
          ...state.fields[formId],
          [field]: value,
        },
      },
    })),

  getField: <T>(formId: string, field: string): T | undefined => {
    return get().fields[formId]?.[field] as T | undefined;
  },

  clearForm: (formId) =>
    set((state) => {
      const { [formId]: _, ...rest } = state.fields;
      return { fields: rest };
    }),
}));

/**
 * Drop-in replacement for useState that persists across route navigation.
 * Values live in a Zustand store (in-memory, no localStorage).
 *
 * @param formId - Unique identifier for the form (e.g., "settings-oidc")
 * @param field - Field name within the form (e.g., "issuer")
 * @param serverDefault - The server-provided default value
 * @returns [value, setter] tuple matching useState API
 */
export function useFormField<T>(
  formId: string,
  field: string,
  serverDefault: T,
): [T, (value: T) => void] {
  const stored = useFormStore((s) => s.fields[formId]?.[field] as T | undefined);
  const setField = useFormStore((s) => s.setField);

  const value = stored !== undefined ? stored : serverDefault;
  const setter = (v: T) => setField(formId, field, v);

  return [value, setter];
}
