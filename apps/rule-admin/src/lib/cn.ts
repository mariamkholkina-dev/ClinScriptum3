/** Лёгкий конкатенатор классов (без clsx/tailwind-merge — не нужны зависимости).
 *  Достаточно для строковых и условных классов из finding-display. */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
