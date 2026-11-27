import {
  addIsoDays,
  differenceInIsoDays,
  getMonthGridDays,
  toLocalIsoDate,
} from "../src/calendar/dateUtils.ts";

const start = "2026-11-27";
if (addIsoDays(start, 4) !== "2026-12-01") {
  throw new Error("Adding days should cross month boundaries correctly.");
}
if (differenceInIsoDays(start, "2026-12-01") !== 4) {
  throw new Error("Date differences should be calculated in calendar days.");
}

const grid = getMonthGridDays(new Date(2026, 10, 1));
if (grid.length !== 42 || grid[0].getDay() !== 1) {
  throw new Error("Month grids should contain six Monday-first weeks.");
}
if (toLocalIsoDate(grid[0]) !== "2026-10-26") {
  throw new Error("Month grids should begin on the Monday before month start.");
}

console.log("✓ Calendar local-date utilities passed.");
