export function createImeDocChangeGate(emit: (value: string) => void) {
  let composing = false;
  let pending = false;

  return {
    get composing() {
      return composing;
    },
    compositionStart() {
      composing = true;
    },
    compositionEnd(doc: string) {
      composing = false;
      if (!pending) return;
      pending = false;
      emit(doc);
    },
    onDocChanged(doc: string) {
      if (composing) {
        pending = true;
        return;
      }
      emit(doc);
    },
  };
}
