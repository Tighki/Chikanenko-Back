import type { DocumentType, PriorityCategory } from "@prisma/client";

export function profileProblems(applicant: {
  lastName: string;
  firstName: string;
  gender: string | null;
  birthDate: Date | null;
  city: string;
  region: string;
  faculty: string;
  specialty: string;
  admissionScore: number;
}): string[] {
  const problems: string[] = [];
  if (!applicant.lastName.trim() || !applicant.firstName.trim()) problems.push("Укажите фамилию и имя");
  if (!applicant.gender) problems.push("Укажите пол");
  if (!applicant.birthDate) problems.push("Укажите дату рождения");
  if (!applicant.city.trim() || !applicant.region.trim()) problems.push("Укажите город и регион");
  if (!applicant.faculty.trim() || !applicant.specialty.trim()) problems.push("Укажите факультет и направление");
  if (!Number.isInteger(applicant.admissionScore) || applicant.admissionScore < 0 || applicant.admissionScore > 400) {
    problems.push("Балл должен быть целым числом от 0 до 400");
  }
  return problems;
}

const LOCKED_STATUSES = new Set(["IN_REVIEW", "APPROVED", "WAITLIST", "SETTLED"]);

export function profileLocked(status?: string | null): boolean {
  return Boolean(status && LOCKED_STATUSES.has(status));
}

export function isPriorityCategory(value: string): value is PriorityCategory {
  return ["ORPHAN", "DISABILITY", "SOCIAL", "OUT_OF_TOWN", "NONE"].includes(value);
}

export function isDocumentType(value: string): value is DocumentType {
  return ["PASSPORT", "ORPHAN", "DISABILITY", "LARGE_FAMILY", "LOW_INCOME", "REGISTRATION", "OTHER"].includes(value);
}
