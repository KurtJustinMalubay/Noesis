export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addIsoDays(value: string, days: number): string {
  const date = parseLocalIsoDate(value);
  date.setDate(date.getDate() + days);
  return toLocalIsoDate(date);
}

export function differenceInIsoDays(from: string, to: string): number {
  const fromDate = parseLocalIsoDate(from);
  const toDate = parseLocalIsoDate(to);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

export function getMonthGridDays(month: Date): Date[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}
