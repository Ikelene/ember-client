import { useState, useEffect } from 'react';

// changed: the page differs from what's saved; onDirty: the shell's (optional); returns [bar, flashSaved]
export function useUnsaved(changed, onDirty) {
  const [bar, setBar] = useState(''); // '' | 'shake' | 'saved'
  useEffect(() => { onDirty?.(changed, () => { setBar('shake'); setTimeout(() => setBar(''), 500); }); }, [changed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const flashSaved = () => { setBar('saved'); setTimeout(() => setBar(''), 1400); };
  return [bar, flashSaved];
}
