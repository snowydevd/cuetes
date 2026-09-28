import { expect, test } from "bun:test";
import { isoUY } from "../src/tiempo";

test("isoUY formatea en hora de Uruguay con offset -03:00", () => {
  expect(isoUY(Date.parse("2026-09-29T02:14:00Z"))).toBe("2026-09-28T23:14:00-03:00");
});

test("isoUY descarta milisegundos", () => {
  expect(isoUY(Date.parse("2026-01-01T03:00:00.999Z"))).toBe("2026-01-01T00:00:00-03:00");
});
