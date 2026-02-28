import type {
  AssistantPlanClass,
  AssistantPlanPatch,
  AssistantPlanProposal,
  AssistantScheduleConstraint,
  GradeOptionsResponse
} from "@/types/academic";

type Shift = "M" | "T" | "N" | "X";
type RelaxationTier = "strict" | "relax_subjects" | "relax_afternoon" | "relax_preference";

interface DecodedSlot {
  raw: string;
  day: string;
  shift: Shift;
  slot: number | null;
}

interface SearchState {
  classes: AssistantPlanClass[];
  usedSlots: Set<string>;
  afternoonDays: Set<string>;
  afternoonClasses: number;
  morningClasses: number;
  weeklyCredits: number;
}

interface StateScore {
  schedulePenalty: number;
  scheduleScore: number;
  subjectsScore: number;
  chsScore: number;
  total: number;
  preferredDistance: number | null;
}

interface TierConfig {
  id: RelaxationTier;
  requireExactSubjects: boolean;
  ignoreAfternoonLimits: boolean;
  ignorePreferredSlot: boolean;
  relaxedMessages: string[];
}

export interface BuildAssistantScheduleProposalsParams {
  gradeOptions: GradeOptionsResponse;
  constraints: AssistantScheduleConstraint;
  periodIndex: number;
  optionsCount?: number;
}

export interface BuildAssistantScheduleProposalsResult {
  proposals: AssistantPlanProposal[];
  diagnostics: {
    proposalCount: number;
    searchSpaceSize: number;
    relaxationTier: RelaxationTier | "none";
  };
}

const DEFAULT_OPTIONS_COUNT = 3;
const DEFAULT_BEAM_WIDTH = 300;
const DEFAULT_MAX_TURMAS_PER_DISCIPLINE = 4;
const PREFERRED_AFTERNOON_STARTS = [13 * 60 + 50, 14 * 60 + 50, 15 * 60 + 50, 16 * 60 + 40];

function decodeHorario(rawHorario: string): DecodedSlot {
  const normalized = rawHorario.trim().toUpperCase();
  const match = normalized.match(/^([2-7])([MTN])(\d+)$/);
  if (!match) {
    return {
      raw: normalized,
      day: "0",
      shift: "X",
      slot: null
    };
  }

  return {
    raw: normalized,
    day: match[1],
    shift: (match[2] as Shift) ?? "X",
    slot: Number(match[3])
  };
}

function preferredAfternoonSlotNumber(slotValue?: string): number | null {
  if (!slotValue) {
    return null;
  }

  const [hourRaw, minuteRaw] = slotValue.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  const minutes = hour * 60 + minute;
  let bestIndex = 0;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (let index = 0; index < PREFERRED_AFTERNOON_STARTS.length; index += 1) {
    const distance = Math.abs(PREFERRED_AFTERNOON_STARTS[index] - minutes);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex + 4;
}

function normalizeCredits(value: number | null): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return 1;
}

function singleClassPenalty(classItem: AssistantPlanClass, preferredAfternoonSlot?: string): number {
  const decoded = classItem.horarios.map((slot) => decodeHorario(slot.horario));
  let morning = 0;
  let afternoon = 0;
  const preferredSlotNumber = preferredAfternoonSlotNumber(preferredAfternoonSlot);
  let bestPreferredDistance = Number.MAX_SAFE_INTEGER;

  for (const item of decoded) {
    if (item.shift === "M") {
      morning += 1;
    } else if (item.shift === "T") {
      afternoon += 1;
      if (preferredSlotNumber !== null && item.slot !== null) {
        bestPreferredDistance = Math.min(bestPreferredDistance, Math.abs(item.slot - preferredSlotNumber));
      }
    }
  }

  const preferredPenalty =
    preferredSlotNumber === null
      ? 0
      : bestPreferredDistance === Number.MAX_SAFE_INTEGER
        ? 8
        : bestPreferredDistance * 2;

  return morning * 4 + afternoon + preferredPenalty;
}

function hasScheduleConflict(state: SearchState, classItem: AssistantPlanClass): boolean {
  return classItem.horarios.some((slot) => state.usedSlots.has(slot.horario.toUpperCase()));
}

function violatesShiftHardConstraint(
  classItem: AssistantPlanClass,
  constraints: AssistantScheduleConstraint
): boolean {
  const blocked = new Set(constraints.blockedShifts ?? []);
  const allowed = constraints.allowedShifts ? new Set(constraints.allowedShifts) : null;

  for (const slot of classItem.horarios) {
    const decoded = decodeHorario(slot.horario);
    if (decoded.shift === "X") {
      continue;
    }
    if (blocked.has(decoded.shift)) {
      return true;
    }
    if (allowed && !allowed.has(decoded.shift)) {
      return true;
    }
  }

  return false;
}

function applyClassToState(state: SearchState, classItem: AssistantPlanClass): SearchState {
  const next: SearchState = {
    classes: [...state.classes, classItem],
    usedSlots: new Set(state.usedSlots),
    afternoonDays: new Set(state.afternoonDays),
    afternoonClasses: state.afternoonClasses,
    morningClasses: state.morningClasses,
    weeklyCredits: state.weeklyCredits + classItem.weeklyCredits
  };

  let hasAfternoon = false;
  for (const horario of classItem.horarios) {
    const decoded = decodeHorario(horario.horario);
    next.usedSlots.add(horario.horario.toUpperCase());
    if (decoded.shift === "T") {
      hasAfternoon = true;
      if (decoded.day !== "0") {
        next.afternoonDays.add(decoded.day);
      }
    }
    if (decoded.shift === "M") {
      next.morningClasses += 1;
    }
  }

  if (hasAfternoon) {
    next.afternoonClasses += 1;
  }

  return next;
}

function violatesAfternoonHardConstraint(
  state: SearchState,
  constraints: AssistantScheduleConstraint,
  ignoreAfternoonLimits: boolean
): boolean {
  if (ignoreAfternoonLimits) {
    return false;
  }
  if (typeof constraints.maxAfternoonClasses === "number" && state.afternoonClasses > constraints.maxAfternoonClasses) {
    return true;
  }
  if (typeof constraints.maxAfternoonDays === "number" && state.afternoonDays.size > constraints.maxAfternoonDays) {
    return true;
  }
  return false;
}

function findPreferredSlotDistance(state: SearchState, preferredSlot?: string): number | null {
  const preferredSlotNumber = preferredAfternoonSlotNumber(preferredSlot);
  if (preferredSlotNumber === null) {
    return null;
  }

  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (const classItem of state.classes) {
    for (const horario of classItem.horarios) {
      const decoded = decodeHorario(horario.horario);
      if (decoded.shift !== "T" || decoded.slot === null) {
        continue;
      }
      bestDistance = Math.min(bestDistance, Math.abs(decoded.slot - preferredSlotNumber));
    }
  }

  if (bestDistance === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return bestDistance;
}

function scoreState(
  state: SearchState,
  constraints: AssistantScheduleConstraint,
  options: { ignorePreferredSlot: boolean }
): StateScore {
  const targetChs = Math.max(1, constraints.targetChsPerPeriod ?? 18);
  const targetSubjects = constraints.targetSubjectsPerPeriod;
  const preferredDistance =
    options.ignorePreferredSlot ? null : findPreferredSlotDistance(state, constraints.preferredAfternoonSlot);

  let schedulePenalty = 0;
  schedulePenalty += state.morningClasses * 4;
  schedulePenalty += state.afternoonClasses;

  if (!options.ignorePreferredSlot && constraints.preferredAfternoonSlot) {
    schedulePenalty += preferredDistance === null ? 8 : preferredDistance * 2;
  }

  if (typeof constraints.maxAfternoonDays === "number") {
    const excessDays = Math.max(0, state.afternoonDays.size - constraints.maxAfternoonDays);
    schedulePenalty += excessDays * 20;
  }

  if (typeof constraints.maxAfternoonClasses === "number") {
    const excessClasses = Math.max(0, state.afternoonClasses - constraints.maxAfternoonClasses);
    schedulePenalty += excessClasses * 20;
  }

  const scheduleScore = Math.max(0, 100 - schedulePenalty);
  const subjectsScore =
    typeof targetSubjects === "number"
      ? Math.max(0, 100 - Math.abs(state.classes.length - targetSubjects) * 20)
      : Math.min(100, state.classes.length * 12);
  const chsScore = Math.max(0, 100 - Math.abs(state.weeklyCredits - targetChs) * 4);

  // Priority order: schedule > subjects > CHS.
  const total = scheduleScore * 1_000_000 + subjectsScore * 1_000 + chsScore;

  return {
    schedulePenalty,
    scheduleScore,
    subjectsScore,
    chsScore,
    total,
    preferredDistance
  };
}

function subjectGap(state: SearchState, targetSubjects?: number): {
  underfill: number;
  overflow: number;
} {
  if (typeof targetSubjects !== "number") {
    return { underfill: 0, overflow: 0 };
  }
  const underfill = Math.max(0, targetSubjects - state.classes.length);
  const overflow = Math.max(0, state.classes.length - targetSubjects);
  return { underfill, overflow };
}

function compareStatesByPriority(
  a: SearchState,
  b: SearchState,
  constraints: AssistantScheduleConstraint,
  options: { ignorePreferredSlot: boolean }
): number {
  const targetSubjects = constraints.targetSubjectsPerPeriod;
  if (typeof targetSubjects === "number") {
    const gapA = subjectGap(a, targetSubjects);
    const gapB = subjectGap(b, targetSubjects);
    if (gapA.underfill !== gapB.underfill) {
      return gapA.underfill - gapB.underfill;
    }
    if (gapA.overflow !== gapB.overflow) {
      return gapA.overflow - gapB.overflow;
    }
  }

  const scoreA = scoreState(a, constraints, options);
  const scoreB = scoreState(b, constraints, options);
  if (scoreB.scheduleScore !== scoreA.scheduleScore) {
    return scoreB.scheduleScore - scoreA.scheduleScore;
  }
  if (scoreB.subjectsScore !== scoreA.subjectsScore) {
    return scoreB.subjectsScore - scoreA.subjectsScore;
  }
  if (scoreB.chsScore !== scoreA.chsScore) {
    return scoreB.chsScore - scoreA.chsScore;
  }
  if (scoreB.total !== scoreA.total) {
    return scoreB.total - scoreA.total;
  }
  if (b.classes.length !== a.classes.length) {
    return b.classes.length - a.classes.length;
  }
  return b.weeklyCredits - a.weeklyCredits;
}

function dedupeStatesBySelection(
  states: SearchState[],
  constraints: AssistantScheduleConstraint,
  options: { ignorePreferredSlot: boolean }
): SearchState[] {
  const bestByKey = new Map<string, { state: SearchState; score: number }>();

  for (const state of states) {
    const key = state.classes
      .map((item) => `${item.code}-${item.classCode}`)
      .sort((a, b) => a.localeCompare(b))
      .join("|");

    const score = scoreState(state, constraints, options).total;
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { state, score });
    }
  }

  return [...bestByKey.values()].map((item) => item.state);
}

function searchTier(params: {
  availableByDiscipline: GradeOptionsResponse["availableByDiscipline"];
  constraints: AssistantScheduleConstraint;
  beamWidth: number;
  maxTurmasPerDiscipline: number;
  ignoreAfternoonLimits: boolean;
  ignorePreferredSlot: boolean;
}): { states: SearchState[]; searchSpaceSize: number } {
  const {
    availableByDiscipline,
    constraints,
    beamWidth,
    maxTurmasPerDiscipline,
    ignoreAfternoonLimits,
    ignorePreferredSlot
  } = params;

  const disciplines = [...availableByDiscipline]
    .filter((discipline) => discipline.turmas.length > 0)
    .sort((a, b) => a.turmas.length - b.turmas.length || a.code.localeCompare(b.code));

  let states: SearchState[] = [
    {
      classes: [],
      usedSlots: new Set<string>(),
      afternoonDays: new Set<string>(),
      afternoonClasses: 0,
      morningClasses: 0,
      weeklyCredits: 0
    }
  ];
  let searchSpaceSize = 0;

  for (const discipline of disciplines) {
    const nextStates: SearchState[] = [];
    const classCandidates: AssistantPlanClass[] = discipline.turmas
      .map((turma) => ({
        code: discipline.code,
        name: discipline.name,
        classCode: turma.codigo,
        horarios: turma.horarios,
        weeklyCredits: normalizeCredits(discipline.credits)
      }))
      .sort((a, b) => singleClassPenalty(a, constraints.preferredAfternoonSlot) - singleClassPenalty(b, constraints.preferredAfternoonSlot))
      .slice(0, maxTurmasPerDiscipline);

    for (const state of states) {
      // Skip discipline branch keeps optionality.
      nextStates.push(state);

      for (const classCandidate of classCandidates) {
        searchSpaceSize += 1;

        if (hasScheduleConflict(state, classCandidate)) {
          continue;
        }
        if (violatesShiftHardConstraint(classCandidate, constraints)) {
          continue;
        }

        const next = applyClassToState(state, classCandidate);
        if (violatesAfternoonHardConstraint(next, constraints, ignoreAfternoonLimits)) {
          continue;
        }
        nextStates.push(next);
      }
    }

    const unique = dedupeStatesBySelection(nextStates, constraints, { ignorePreferredSlot });
    unique.sort((a, b) => compareStatesByPriority(a, b, constraints, { ignorePreferredSlot }));
    states = unique.slice(0, beamWidth);
  }

  return {
    states: states.filter((state) => state.classes.length > 0),
    searchSpaceSize
  };
}

function buildPatch(
  state: SearchState,
  periodIndex: number,
  targetChs: number,
  constraintsApplied: AssistantScheduleConstraint
): AssistantPlanPatch {
  const classes = [...state.classes].sort((a, b) => a.code.localeCompare(b.code) || a.classCode.localeCompare(b.classCode));
  return {
    periodIndex,
    targetChs,
    achievedChs: state.weeklyCredits,
    constraintsApplied,
    classes,
    payload: {
      periodIndex,
      disciplines: classes.map((item) => item.code),
      classes: classes.map((item) => ({
        code: item.code,
        classCode: item.classCode,
        horarios: item.horarios.map((slot) => slot.horario),
        weeklyCredits: item.weeklyCredits
      }))
    }
  };
}

function buildConstraintReport(params: {
  state: SearchState;
  baseConstraints: AssistantScheduleConstraint;
  tier: TierConfig;
  preferredDistance: number | null;
}): AssistantPlanProposal["constraintReport"] {
  const { state, baseConstraints, tier, preferredDistance } = params;
  const met: string[] = ["Sem conflitos de horário."];
  const violated: string[] = [];

  if (baseConstraints.allowedShifts && baseConstraints.allowedShifts.length > 0) {
    met.push(`Turnos permitidos respeitados: ${baseConstraints.allowedShifts.join(", ")}.`);
  }
  if (baseConstraints.blockedShifts && baseConstraints.blockedShifts.length > 0) {
    met.push(`Turnos bloqueados respeitados: ${baseConstraints.blockedShifts.join(", ")}.`);
  }
  if (typeof baseConstraints.maxAfternoonDays === "number" && state.afternoonDays.size <= baseConstraints.maxAfternoonDays) {
    met.push(`Limite de dias à tarde respeitado (${state.afternoonDays.size}/${baseConstraints.maxAfternoonDays}).`);
  } else if (typeof baseConstraints.maxAfternoonDays === "number") {
    violated.push(`Dias à tarde acima do limite (${state.afternoonDays.size}/${baseConstraints.maxAfternoonDays}).`);
  }
  if (
    typeof baseConstraints.maxAfternoonClasses === "number" &&
    state.afternoonClasses <= baseConstraints.maxAfternoonClasses
  ) {
    met.push(`Limite de matérias à tarde respeitado (${state.afternoonClasses}/${baseConstraints.maxAfternoonClasses}).`);
  } else if (typeof baseConstraints.maxAfternoonClasses === "number") {
    violated.push(`Matérias à tarde acima do limite (${state.afternoonClasses}/${baseConstraints.maxAfternoonClasses}).`);
  }
  if (typeof baseConstraints.targetSubjectsPerPeriod === "number") {
    if (state.classes.length === baseConstraints.targetSubjectsPerPeriod) {
      met.push(`Meta de matérias atendida (${state.classes.length}).`);
    } else {
      violated.push(`Meta de matérias não atendida (${state.classes.length}/${baseConstraints.targetSubjectsPerPeriod}).`);
    }
  }
  if (typeof baseConstraints.targetChsPerPeriod === "number") {
    if (state.weeklyCredits === baseConstraints.targetChsPerPeriod) {
      met.push(`Meta de CHS atendida (${state.weeklyCredits}).`);
    } else {
      violated.push(`Meta de CHS não atendida (${state.weeklyCredits}/${baseConstraints.targetChsPerPeriod}).`);
    }
  }
  if (baseConstraints.preferredAfternoonSlot) {
    if (preferredDistance !== null && preferredDistance <= 1) {
      met.push(`Preferência de horário próxima de ${baseConstraints.preferredAfternoonSlot}.`);
    } else if (preferredDistance !== null) {
      violated.push(`Preferência de horário ${baseConstraints.preferredAfternoonSlot} não ficou próxima.`);
    } else {
      violated.push(`Não houve aula próxima da preferência ${baseConstraints.preferredAfternoonSlot}.`);
    }
  }

  return {
    met,
    relaxed: tier.relaxedMessages,
    violated
  };
}

function proposalSelectionKey(proposal: AssistantPlanProposal): string {
  return proposal.classes
    .map((item) => `${item.code}-${item.classCode}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

export function buildAssistantScheduleProposals(
  params: BuildAssistantScheduleProposalsParams
): BuildAssistantScheduleProposalsResult {
  const optionsCount = Math.max(1, params.optionsCount ?? DEFAULT_OPTIONS_COUNT);
  const baseConstraints = params.constraints;
  const targetChs = Math.max(1, baseConstraints.targetChsPerPeriod ?? 18);

  const tiers: TierConfig[] = [
    {
      id: "strict",
      requireExactSubjects: typeof baseConstraints.targetSubjectsPerPeriod === "number",
      ignoreAfternoonLimits: false,
      ignorePreferredSlot: false,
      relaxedMessages: []
    },
    {
      id: "relax_subjects",
      requireExactSubjects: false,
      ignoreAfternoonLimits: false,
      ignorePreferredSlot: false,
      relaxedMessages: ["Meta de matérias flexibilizada para ampliar opções viáveis."]
    },
    {
      id: "relax_afternoon",
      requireExactSubjects: false,
      ignoreAfternoonLimits: true,
      ignorePreferredSlot: false,
      relaxedMessages: [
        "Meta de matérias flexibilizada para ampliar opções viáveis.",
        "Limites de tarde flexibilizados para aumentar encaixes."
      ]
    },
    {
      id: "relax_preference",
      requireExactSubjects: false,
      ignoreAfternoonLimits: true,
      ignorePreferredSlot: true,
      relaxedMessages: [
        "Meta de matérias flexibilizada para ampliar opções viáveis.",
        "Limites de tarde flexibilizados para aumentar encaixes.",
        "Preferência de horário flexibilizada para aumentar cobertura."
      ]
    }
  ];

  const proposals: AssistantPlanProposal[] = [];
  const seenSelectionKeys = new Set<string>();
  let totalSearchSpace = 0;
  let highestTierUsed: RelaxationTier | "none" = "none";

  for (const tier of tiers) {
    if (proposals.length >= optionsCount) {
      break;
    }

    const effectiveConstraints: AssistantScheduleConstraint = {
      ...baseConstraints,
      maxAfternoonDays: tier.ignoreAfternoonLimits ? undefined : baseConstraints.maxAfternoonDays,
      maxAfternoonClasses: tier.ignoreAfternoonLimits ? undefined : baseConstraints.maxAfternoonClasses,
      preferredAfternoonSlot: tier.ignorePreferredSlot ? undefined : baseConstraints.preferredAfternoonSlot
    };

    const search = searchTier({
      availableByDiscipline: params.gradeOptions.availableByDiscipline,
      constraints: effectiveConstraints,
      beamWidth: DEFAULT_BEAM_WIDTH,
      maxTurmasPerDiscipline: DEFAULT_MAX_TURMAS_PER_DISCIPLINE,
      ignoreAfternoonLimits: tier.ignoreAfternoonLimits,
      ignorePreferredSlot: tier.ignorePreferredSlot
    });
    totalSearchSpace += search.searchSpaceSize;

    const rankedStates = [...search.states]
      .filter((state) =>
        tier.requireExactSubjects && typeof baseConstraints.targetSubjectsPerPeriod === "number"
          ? state.classes.length === baseConstraints.targetSubjectsPerPeriod
          : true
      )
      .sort((a, b) => compareStatesByPriority(a, b, effectiveConstraints, { ignorePreferredSlot: tier.ignorePreferredSlot }));

    for (const state of rankedStates) {
      if (proposals.length >= optionsCount) {
        break;
      }

      const score = scoreState(state, effectiveConstraints, { ignorePreferredSlot: tier.ignorePreferredSlot });
      const patch = buildPatch(state, params.periodIndex, targetChs, effectiveConstraints);
      const proposal: AssistantPlanProposal = {
        id: `${tier.id}-${params.periodIndex}-${proposals.length + 1}`,
        periodIndex: params.periodIndex,
        achievedChs: state.weeklyCredits,
        subjectsCount: state.classes.length,
        classes: patch.classes,
        constraintReport: buildConstraintReport({
          state,
          baseConstraints,
          tier,
          preferredDistance: score.preferredDistance
        }),
        scoreBreakdown: {
          scheduleScore: score.scheduleScore,
          subjectsScore: score.subjectsScore,
          chsScore: score.chsScore,
          total: score.total
        },
        patch
      };

      const selectionKey = proposalSelectionKey(proposal);
      if (seenSelectionKeys.has(selectionKey)) {
        continue;
      }
      seenSelectionKeys.add(selectionKey);
      proposals.push(proposal);
      highestTierUsed = tier.id;
    }
  }

  return {
    proposals,
    diagnostics: {
      proposalCount: proposals.length,
      searchSpaceSize: totalSearchSpace,
      relaxationTier: highestTierUsed
    }
  };
}
