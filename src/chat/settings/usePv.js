// the settings preview's hover state (ui.jsx)
import { useContext, createContext } from 'react';

export const HoverCtx = createContext({ target: null, set: () => {} });

// className for something in the preview: outlined while its setting is hovered
export function usePv(name) {
  const { target } = useContext(HoverCtx);
  return target && (Array.isArray(name) ? name.includes(target) : target === name) ? ' pv-hl' : '';
}
