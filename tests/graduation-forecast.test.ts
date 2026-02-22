import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { calculateRoadmap } from "@/lib/domain/matriz-engine";
import {
  buildGraduationForecast,
  extractOfficialMissingFromTranscript,
  resolveMissingWorkload
} from "@/lib/domain/graduation-forecast";
import { parseHistoricoText } from "@/lib/parser/historico-parser";
import type { ParsedTranscript, RoadmapResult } from "@/types/academic";

describe("graduation forecast", () => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/historico-sample.txt");
  const raw = readFileSync(fixturePath, "utf8");

  let parsed: ParsedTranscript;
  let roadmap: RoadmapResult;

  beforeAll(async () => {
    parsed = parseHistoricoText(raw);
    roadmap = await calculateRoadmap(parsed, "981");
  });

  it("starts historical series at the first semester with real CHS production", () => {
    const forecast = buildGraduationForecast({ parsedTranscript: parsed, roadmap });
    expect(forecast).not.toBeNull();
    expect(forecast?.startLabel).toBe("2023-1");
    expect(forecast?.historyBySemester[0]?.label).toBe("2023-1");
  });

  it("uses official summary for missing workload and keeps CHEXT outside CHS estimate", () => {
    const official = extractOfficialMissingFromTranscript(parsed);
    const forecast = buildGraduationForecast({ parsedTranscript: parsed, roadmap });

    expect(official).not.toBeNull();
    expect(official?.totalMissingCht).toBe(975);
    expect(official?.totalMissingChs).toBe(65);
    expect(official?.missingChext).toBe(270);
    expect(forecast?.missingCht).toBe(975);
    expect(forecast?.missingChs).toBe(65);
    expect(forecast?.missingChext).toBe(270);
    expect(forecast?.missingSource).toBe("official_summary");
  });

  it("never produces projected semesters with zero CHS", () => {
    const forecast = buildGraduationForecast({ parsedTranscript: parsed, roadmap });
    expect(forecast).not.toBeNull();
    expect(forecast?.projectedBySemester.length).toBeGreaterThan(0);
    expect(forecast?.projectedBySemester.every((item) => item.projectedChs > 0)).toBe(true);
  });

  it("keeps assistant/dashboard consistency by resolving missing workload from the same source", () => {
    const forecast = buildGraduationForecast({ parsedTranscript: parsed, roadmap });
    const resolved = resolveMissingWorkload({ parsedTranscript: parsed, roadmap });

    expect(forecast).not.toBeNull();
    expect(resolved.missingCht).toBe(forecast?.missingCht);
    expect(resolved.missingChs).toBe(forecast?.missingChs);
    expect(resolved.missingChext).toBe(forecast?.missingChext);
    expect(resolved.source).toBe(forecast?.missingSource);
  });

  it("falls back to roadmap missing when official summary is unavailable", () => {
    const parsedWithoutSummary: ParsedTranscript = {
      ...parsed,
      summary: [],
      extensionSummary: []
    };

    const expectedFallbackCht = roadmap.progress.reduce((sum, bucket) => sum + bucket.missingCHT, 0);
    const forecast = buildGraduationForecast({
      parsedTranscript: parsedWithoutSummary,
      roadmap
    });

    expect(forecast).not.toBeNull();
    expect(forecast?.missingSource).toBe("roadmap_fallback");
    expect(forecast?.missingCht).toBe(expectedFallbackCht);
    expect(forecast?.missingChs).toBe(Math.ceil(expectedFallbackCht / 15));
    expect(forecast?.missingChext).toBe(0);
  });
});
