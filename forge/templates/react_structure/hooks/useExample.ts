import { useEffect, useState } from "react";

/**
 * Example hook — replace with your own. Demonstrates the hooks/ convention:
 * one hook per file, named useXxx, returning whatever state/handlers the
 * component needs.
 */
export function useExample(initialValue: number = 0) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    // side effects go here
  }, [value]);

  return { value, setValue };
}
