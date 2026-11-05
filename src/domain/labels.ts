import type { PriorityCategory, DocumentType } from "@prisma/client";

export const CATEGORY_TITLES: Record<PriorityCategory, string> = {
  ORPHAN: "Дети-сироты и дети, оставшиеся без попечения родителей",
  DISABILITY: "Инвалиды I и II группы, дети-инвалиды",
  SOCIAL: "Из многодетных и малоимущих семей",
  OUT_OF_TOWN: "Иногородние",
  NONE: "Без льготы",
};

export const STATUS_LABELS = {
  DRAFT: "Черновик",
  SUBMITTED: "Подана",
  IN_REVIEW: "На проверке",
  APPROVED: "Допуск",
  REJECTED: "Отказ",
  WAITLIST: "Очередь",
  SETTLED: "Заселён",
  CANCELLED: "Отменена",
} as const;

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  PASSPORT: "Паспорт",
  ORPHAN: "Документ о статусе сироты",
  DISABILITY: "Справка об инвалидности",
  LARGE_FAMILY: "Удостоверение многодетной семьи",
  LOW_INCOME: "Справка о малообеспеченности",
  REGISTRATION: "Регистрация по месту жительства",
  OTHER: "Иной документ",
};

export const GENDER_LABELS = {
  MALE: "Мужской",
  FEMALE: "Женский",
} as const;

export const ROLE_LABELS = {
  APPLICANT: "Абитуриент",
  STAFF: "Сотрудник",
  ADMIN: "Администратор",
} as const;

/** Каждая группа — набор типов, из которых достаточно одного проверенного документа. */
export function requiredDocumentGroups(category: PriorityCategory): DocumentType[][] {
  switch (category) {
    case "ORPHAN":
      return [["PASSPORT"], ["ORPHAN"]];
    case "DISABILITY":
      return [["PASSPORT"], ["DISABILITY"]];
    case "SOCIAL":
      return [["PASSPORT"], ["LARGE_FAMILY", "LOW_INCOME"]];
    case "OUT_OF_TOWN":
      return [["PASSPORT"], ["REGISTRATION"]];
    case "NONE":
      return [["PASSPORT"]];
  }
}

export function missingDocumentLabels(
  category: PriorityCategory,
  verifiedTypes: DocumentType[],
): string[] {
  const have = new Set(verifiedTypes);
  const missing: string[] = [];
  for (const group of requiredDocumentGroups(category)) {
    if (!group.some((type) => have.has(type))) {
      missing.push(group.map((type) => DOCUMENT_LABELS[type]).join(" или "));
    }
  }
  return missing;
}

export function fullName(parts: {
  lastName: string;
  firstName: string;
  middleName?: string | null;
}): string {
  return [parts.lastName, parts.firstName, parts.middleName].filter(Boolean).join(" ");
}

export function campaignIsOpen(
  campaign: { active: boolean; startsAt: Date; endsAt: Date },
  now = new Date(),
): boolean {
  return campaign.active && now >= campaign.startsAt && now <= campaign.endsAt;
}
