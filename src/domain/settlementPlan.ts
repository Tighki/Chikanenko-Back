import type { PriorityCategory } from "@prisma/client";

export type PlanGender = "MALE" | "FEMALE";

export type PlanApplicant = {
  applicationId: string;
  userId: string;
  fullName: string;
  gender: PlanGender;
  faculty: string;
  score: number;
  priorityRank: number;
  category: PriorityCategory;
  categoryTitle: string;
  submittedAt: Date | null;
  distanceKm?: number | null;
  needsAccessible: boolean;
  documentsOk: boolean;
  documentProblem?: string;
};

export type PlanBed = {
  id: string;
  number: number;
  roomId: string;
  roomNumber: string;
  floor: number;
  gender: PlanGender;
  accessible: boolean;
  roomActive: boolean;
  buildingName: string;
  occupiedFaculties: string[];
};

export type PlanRow = {
  applicationId: string;
  userId: string;
  fullName: string;
  faculty: string;
  gender: PlanGender;
  category: PriorityCategory;
  categoryTitle: string;
  score: number;
  distanceKm: number | null;
  submittedAt: string | null;
  outcome: "SETTLED" | "WAITLIST" | "SKIPPED";
  reason: string;
  bedId?: string;
  buildingName?: string;
  roomNumber?: string;
  bedNumber?: number;
  accessible?: boolean;
};

/**
 * Жадное распределение.
 * Сортировка: льгота, балл по убыванию, дата подачи.
 * Койка: тот же пол, открытая комната, свободное место.
 * Инвалидность сначала берёт доступную среду. Остальные берут её только если обычных мест нет.
 * При группировке по факультету предпочтительнее комната, где этот факультет уже есть.
 */
export function buildSettlementPlan(
  applicants: PlanApplicant[],
  beds: PlanBed[],
  options: { groupByFaculty: boolean },
): PlanRow[] {
  const ordered = [...applicants].sort(compareApplicants);
  const faculties = new Map<string, Set<string>>();
  for (const bed of beds) {
    if (!faculties.has(bed.roomId)) {
      faculties.set(bed.roomId, new Set(bed.occupiedFaculties));
    }
  }
  const used = new Set<string>();
  const rows: PlanRow[] = [];

  for (const applicant of ordered) {
    const base = {
      applicationId: applicant.applicationId,
      userId: applicant.userId,
      fullName: applicant.fullName,
      faculty: applicant.faculty,
      gender: applicant.gender,
      category: applicant.category,
      categoryTitle: applicant.categoryTitle,
      score: applicant.score,
      distanceKm: applicant.distanceKm ?? null,
      submittedAt: applicant.submittedAt ? applicant.submittedAt.toISOString() : null,
    };

    if (!applicant.documentsOk) {
      rows.push({
        ...base,
        outcome: "SKIPPED",
        reason: applicant.documentProblem || "Не проверены обязательные документы",
      });
      continue;
    }

    const bed = pickBed(applicant, beds, used, faculties, options.groupByFaculty);
    if (!bed) {
      rows.push({
        ...base,
        outcome: "WAITLIST",
        reason: "Свободных мест подходящего пола не осталось",
      });
      continue;
    }

    used.add(bed.id);
    const roomFaculties = faculties.get(bed.roomId) ?? new Set<string>();
    if (applicant.faculty) roomFaculties.add(applicant.faculty);
    faculties.set(bed.roomId, roomFaculties);

    rows.push({
      ...base,
      outcome: "SETTLED",
      reason: bed.accessible ? "Место в комнате доступной среды" : "Место в обычной комнате",
      bedId: bed.id,
      buildingName: bed.buildingName,
      roomNumber: bed.roomNumber,
      bedNumber: bed.number,
      accessible: bed.accessible,
    });
  }

  return rows;
}

export function compareApplicants(a: PlanApplicant, b: PlanApplicant): number {
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  if (a.score !== b.score) return b.score - a.score;
  const at = a.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bt = b.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return a.fullName.localeCompare(b.fullName, "ru");
}

function pickBed(
  applicant: PlanApplicant,
  beds: PlanBed[],
  used: Set<string>,
  faculties: Map<string, Set<string>>,
  groupByFaculty: boolean,
): PlanBed | null {
  const free = beds.filter(
    (bed) => !used.has(bed.id) && bed.roomActive && bed.gender === applicant.gender,
  );
  const accessible = free.filter((bed) => bed.accessible);
  const regular = free.filter((bed) => !bed.accessible);
  const pool = applicant.needsAccessible
    ? accessible.length > 0
      ? accessible
      : regular
    : regular.length > 0
      ? regular
      : accessible;

  const ranked = [...pool].sort((a, b) => {
    if (groupByFaculty) {
      const facultyDelta =
        facultyRank(faculties.get(a.roomId), applicant.faculty) -
        facultyRank(faculties.get(b.roomId), applicant.faculty);
      if (facultyDelta !== 0) return facultyDelta;
    }
    return (
      a.buildingName.localeCompare(b.buildingName, "ru") ||
      a.floor - b.floor ||
      compareRoomNumber(a.roomNumber, b.roomNumber) ||
      a.number - b.number
    );
  });

  return ranked[0] ?? null;
}

function facultyRank(current: Set<string> | undefined, faculty: string): number {
  if (!current || current.size === 0 || !faculty) return 1;
  if (current.has(faculty)) return 0;
  return 2;
}

function compareRoomNumber(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a && String(nb) === b) {
    return na - nb;
  }
  return a.localeCompare(b, "ru", { numeric: true });
}
