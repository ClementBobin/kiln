/**
 * lib/ — framework-agnostic helpers (no React imports here). Add things
 * like API clients, formatters, validators, etc.
 */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
