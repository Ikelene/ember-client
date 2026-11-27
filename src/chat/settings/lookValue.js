// the look settings as a value that re-renders when it changes
import { useSyncExternalStore } from 'react';
import { subscribeLook, getLook } from '../look.js';

export const useLook = () => useSyncExternalStore(subscribeLook, getLook);

export const useLookValue = useLook;
