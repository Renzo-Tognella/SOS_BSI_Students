import type { CurriculumMatrix, GraphNodeStatus, PrereqGraphEdge, PrereqGraphNode } from "@/types/academic";

interface BuildGraphInput {
  matrix: CurriculumMatrix;
  completedCodes: Set<string>;
  outsideScopeCodes?: string[];
}

function resolveNodeStatus(code: string, prerequisites: string[], completedCodes: Set<string>): GraphNodeStatus {
  if (completedCodes.has(code)) {
    return "DONE";
  }
  if (prerequisites.length === 0 || prerequisites.every((pre) => completedCodes.has(pre))) {
    return "AVAILABLE";
  }
  return "BLOCKED";
}

export function buildPrereqGraph({ matrix, completedCodes, outsideScopeCodes = [] }: BuildGraphInput): {
  nodes: PrereqGraphNode[];
  edges: PrereqGraphEdge[];
} {
  const dependentsMap = new Map<string, Set<string>>();
  const edges: PrereqGraphEdge[] = [];

  for (const discipline of matrix.disciplines) {
    for (const prereq of discipline.prerequisites) {
      edges.push({ from: prereq, to: discipline.code });
      const current = dependentsMap.get(prereq) ?? new Set<string>();
      current.add(discipline.code);
      dependentsMap.set(prereq, current);
    }
  }

  const nodes: PrereqGraphNode[] = matrix.disciplines.map((discipline) => ({
    code: discipline.code,
    name: discipline.name,
    status: resolveNodeStatus(discipline.code, discipline.prerequisites, completedCodes),
    category: discipline.category,
    subcategory: discipline.subcategory,
    track: discipline.track,
    recommendedPeriod: discipline.recommendedPeriod,
    cht: discipline.cht,
    prerequisites: discipline.prerequisites,
    dependents: [...(dependentsMap.get(discipline.code) ?? new Set())]
  }));

  const knownCodes = new Set(nodes.map((node) => node.code));
  for (const outsideCode of outsideScopeCodes) {
    if (knownCodes.has(outsideCode)) {
      continue;
    }
    nodes.push({
      code: outsideCode,
      name: outsideCode,
      status: "OUTSIDE_SCOPE",
      category: "UNKNOWN",
      cht: 0,
      prerequisites: [],
      dependents: []
    });
  }

  return { nodes, edges };
}
