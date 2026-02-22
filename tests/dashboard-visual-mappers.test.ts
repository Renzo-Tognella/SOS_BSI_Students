import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { buildDashboardVisualModel } from "@/lib/domain/dashboard-visual-mappers";
import { calculateRoadmap } from "@/lib/domain/matriz-engine";
import { parseHistoricoText } from "@/lib/parser/historico-parser";
import type { ManualPlannerVisualInput } from "@/lib/domain/dashboard-visual-mappers";
import type { ParsedTranscript, RoadmapResult } from "@/types/academic";

describe("dashboard visual mappers", () => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/historico-sample.txt");
  const raw = readFileSync(fixturePath, "utf8");

  let parsed: ParsedTranscript;
  let roadmap: RoadmapResult;

  beforeAll(async () => {
    parsed = parseHistoricoText(raw);
    roadmap = await calculateRoadmap(parsed, "981");
  });

  it("builds visual model using official missing workload and keeps CHEXT separated", () => {
    const model = buildDashboardVisualModel({
      roadmap,
      parsedTranscript: parsed,
      manualPlannerData: null,
      missingCht: 975,
      missingChs: 65,
      missingChext: 270
    });

    expect(model.missingCht).toBe(975);
    expect(model.missingChs).toBe(65);
    expect(model.missingChext).toBe(270);
    expect(model.totalSubjects).toBeGreaterThan(0);
    expect(model.completedSubjects).toBeGreaterThan(0);
    expect(model.overallProgressPercent).toBeGreaterThan(0);
  });

  it("ignores extension bucket when calculating visual progress percentage", () => {
    const base = buildDashboardVisualModel({
      roadmap,
      parsedTranscript: parsed,
      manualPlannerData: null,
      missingCht: 975,
      missingChs: 65,
      missingChext: 270
    });

    const roadmapWithHugeExtension: RoadmapResult = {
      ...roadmap,
      progress: roadmap.progress.map((bucket) => {
        if (bucket.key !== "extension") {
          return bucket;
        }

        return {
          ...bucket,
          requiredCHT: bucket.requiredCHT + 1000,
          validatedCHT: 0,
          completedCHT: 0,
          missingCHT: bucket.requiredCHT + 1000
        };
      })
    };

    const withHugeExtension = buildDashboardVisualModel({
      roadmap: roadmapWithHugeExtension,
      parsedTranscript: parsed,
      manualPlannerData: null,
      missingCht: 975,
      missingChs: 65,
      missingChext: 270
    });

    expect(withHugeExtension.overallProgressPercent).toBe(base.overallProgressPercent);
  });

  it("maps planner schedule into live events and next class", () => {
    const firstNode = roadmap.prereqGraph.nodes.find((node) => node.status !== "OUTSIDE_SCOPE");
    expect(firstNode).toBeTruthy();

    const manualPlannerData: ManualPlannerVisualInput = {
      periods: [
        {
          periodIndex: 1,
          totalChs: 4,
          totalCht: firstNode?.cht ?? 60,
          disciplines: [
            {
              code: firstNode?.code ?? "IFG90",
              name: firstNode?.name ?? "Disciplina",
              cht: firstNode?.cht ?? 60
            }
          ],
          agenda: [
            {
              code: firstNode?.code ?? "IFG90",
              name: firstNode?.name ?? "Disciplina",
              turma: "S11",
              horario: "2N1",
              sala: "A1"
            }
          ]
        }
      ],
      unassigned: []
    };

    const model = buildDashboardVisualModel({
      roadmap,
      parsedTranscript: parsed,
      manualPlannerData,
      missingCht: 975,
      missingChs: 65,
      missingChext: 270
    });

    expect(model.events.length).toBeGreaterThan(0);
    expect(model.events[0].type).toBe("live");
    expect(model.events[0].countdownLabel.length).toBeGreaterThan(0);
    expect(model.nextClass).not.toBeNull();
    expect(model.studyDistribution.some((cell) => cell.hours > 0)).toBe(true);
  });

  it("produces stable fallback values when transcript/planner data are missing", () => {
    const model = buildDashboardVisualModel({
      roadmap,
      parsedTranscript: null,
      manualPlannerData: null,
      missingCht: 100,
      missingChs: 7,
      missingChext: 0
    });

    expect(model.averageGrade).toBeNull();
    expect(model.events).toHaveLength(0);
    expect(model.nextClass).toBeNull();
    expect(model.missingChs).toBe(7);
    expect(model.subjects.length).toBeGreaterThan(0);
    expect(model.suggestions.length).toBeGreaterThan(0);
  });
});
