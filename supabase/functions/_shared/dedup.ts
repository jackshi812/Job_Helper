function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprint(
  company: string,
  title: string,
  location: string | null,
): string {
  const city = (location ?? '').split(',')[0]
  return `${normalize(company)}|${normalize(title)}|${normalize(city)}`
}
