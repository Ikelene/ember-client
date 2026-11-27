import { useLayoutEffect } from 'react';

// keep the picker inside the window
export function usePickerPlacement(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.left < 8) el.style.transform = `translateX(${8 - r.left}px)`;
  });
}
