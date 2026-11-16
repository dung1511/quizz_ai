export function normalizeQuizTitle(value: string): string {
  return value.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
}
