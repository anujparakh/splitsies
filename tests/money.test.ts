import { describe, expect, it } from "vitest";
import {
  formatCentsPlain,
  formatUsd,
  parseDollarsToCents,
} from "../shared/money";

describe("parseDollarsToCents", () => {
  it("parses plain dollar amounts", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("12.50")).toBe(1250);
    expect(parseDollarsToCents("0.01")).toBe(1);
  });

  it("parses the inexact-in-binary-float case exactly", () => {
    expect(parseDollarsToCents("0.1")).toBe(10);
    expect(parseDollarsToCents("0.07")).toBe(7);
    expect(parseDollarsToCents("1.10")).toBe(110);
  });

  it("tolerates what people actually type", () => {
    expect(parseDollarsToCents(" 12.50 ")).toBe(1250);
    expect(parseDollarsToCents("$12.50")).toBe(1250);
    expect(parseDollarsToCents("1,234.56")).toBe(123456);
    expect(parseDollarsToCents(".5")).toBe(50);
    expect(parseDollarsToCents("0")).toBe(0);
  });

  it("rejects junk rather than guessing", () => {
    for (const bad of ["", " ", ".", "$", "abc", "1.2.3", "-5", "1e3", "12.345"]) {
      expect(parseDollarsToCents(bad), bad).toBeNull();
    }
  });
});

describe("formatUsd", () => {
  it("formats cents as dollars", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1)).toBe("$0.01");
    expect(formatUsd(1250)).toBe("$12.50");
    expect(formatUsd(100)).toBe("$1.00");
  });

  it("groups thousands", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(100000000)).toBe("$1,000,000.00");
  });

  it("puts the sign before the symbol", () => {
    expect(formatUsd(-1250)).toBe("-$12.50");
  });
});

describe("formatCentsPlain", () => {
  it("formats without symbol or grouping, for form inputs", () => {
    expect(formatCentsPlain(1250)).toBe("12.50");
    expect(formatCentsPlain(123456)).toBe("1234.56");
    expect(formatCentsPlain(5)).toBe("0.05");
  });
});

describe("round trip", () => {
  it("survives parse → format → parse for every cent value in a range", () => {
    for (const cents of [0, 1, 7, 10, 99, 100, 101, 1250, 123456, 99999999]) {
      expect(parseDollarsToCents(formatCentsPlain(cents))).toBe(cents);
    }
  });
});
