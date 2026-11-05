import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildSettlementPlan, type PlanApplicant, type PlanBed, type PlanRow } from "../domain/settlementPlan.js";
import { CATEGORY_TITLES, fullName, missingDocumentLabels } from "../domain/labels.js";
import { notify, writeAudit, type Db } from "./audit.js";
import { HttpError } from "../middleware/error.js";

const applicationInclude = {
  applicant: { include: { user: true } },
  documents: true,
} as const;

export async function computePlan(db: Db, groupByFaculty: boolean): Promise<PlanRow[]> {
  const [applications, beds, rules] = await Promise.all([
    db.application.findMany({
      where: { status: { in: ["APPROVED", "WAITLIST"] }, settlement: { is: null } },
      include: applicationInclude,
    }),
    db.bed.findMany({
      where: { status: "FREE" },
      include: {
        room: {
          include: {
            building: true,
            beds: {
              include: {
                settlement: { include: { application: { include: { applicant: true } } } },
              },
            },
          },
        },
      },
    }),
    db.priorityRule.findMany(),
  ]);

  const rankByCategory = new Map(rules.map((rule) => [rule.category, rule.rank]));
  const people: PlanApplicant[] = applications.map((application) => {
    const person = application.applicant;
    const verified = application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type);
    const missing = missingDocumentLabels(person.priorityCategory, verified);
    const genderKnown = person.gender === "MALE" || person.gender === "FEMALE";
    return {
      applicationId: application.id,
      userId: person.userId,
      fullName: fullName(person) || person.user.fullName,
      gender: genderKnown ? person.gender! : "MALE",
      faculty: person.faculty,
      score: person.admissionScore,
      distanceKm: person.distanceKm,
      priorityRank: rankByCategory.get(person.priorityCategory) ?? 99,
      category: person.priorityCategory,
      categoryTitle: rankTitle(rules, person.priorityCategory),
      submittedAt: application.submittedAt,
      needsAccessible: person.priorityCategory === "DISABILITY",
      documentsOk: genderKnown && missing.length === 0,
      documentProblem: !genderKnown
        ? "В анкете не указан пол"
        : missing.length > 0
          ? `Не проверены документы: ${missing.join(", ")}`
          : undefined,
    };
  });

  const planBeds: PlanBed[] = beds.map((bed) => ({
    id: bed.id,
    number: bed.number,
    roomId: bed.roomId,
    roomNumber: bed.room.number,
    floor: bed.room.floor,
    gender: bed.room.gender,
    accessible: bed.room.accessible,
    roomActive: bed.room.status === "ACTIVE",
    buildingName: bed.room.building.name,
    occupiedFaculties: bed.room.beds
      .map((item) => item.settlement?.application.applicant.faculty)
      .filter((faculty): faculty is string => Boolean(faculty)),
  }));

  return buildSettlementPlan(people, planBeds, { groupByFaculty });
}

function rankTitle(
  rules: { category: PlanApplicant["category"]; title: string }[],
  category: PlanApplicant["category"],
): string {
  return rules.find((rule) => rule.category === category)?.title ?? CATEGORY_TITLES[category];
}

export function summarize(rows: PlanRow[]) {
  return {
    rows,
    settledCount: rows.filter((row) => row.outcome === "SETTLED").length,
    waitlistCount: rows.filter((row) => row.outcome === "WAITLIST").length,
    skippedCount: rows.filter((row) => row.outcome === "SKIPPED").length,
  };
}

async function nextOrderNumber(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `НЗ-${year}-`;
  const latest = await db.settlement.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
  });
  let seq = 1;
  if (latest) {
    const parsed = Number(latest.orderNumber.slice(prefix.length));
    if (Number.isFinite(parsed)) seq = parsed + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function confirmPlan(userId: string, groupByFaculty: boolean) {
  return prisma.$transaction(
    async (tx) => {
      const rows = await computePlan(tx, groupByFaculty);
      const bedIds = rows.map((row) => row.bedId).filter((id): id is string => Boolean(id));
      if (bedIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "Bed" WHERE id IN (${Prisma.join(bedIds)}) FOR UPDATE`;
        const stillFree = await tx.bed.count({ where: { id: { in: bedIds }, status: "FREE" } });
        if (stillFree !== bedIds.length) {
          throw new HttpError(409, "Места уже изменились. Рассчитайте распределение заново");
        }
      }

      const campaign = await tx.campaign.findUnique({ where: { id: "default" } });
      const summary = summarize(rows);
      const run = await tx.settlementRun.create({
        data: {
          startedById: userId,
          groupByFaculty,
          finishedAt: new Date(),
          summary: {
            settledCount: summary.settledCount,
            waitlistCount: summary.waitlistCount,
            skippedCount: summary.skippedCount,
          },
        },
      });

      for (const row of rows) {
        if (row.outcome === "SETTLED" && row.bedId) {
          const orderNumber = await nextOrderNumber(tx);
          const occupied = await tx.bed.updateMany({
            where: { id: row.bedId, status: "FREE" },
            data: { status: "OCCUPIED" },
          });
          if (occupied.count !== 1) {
            throw new HttpError(409, "Места уже изменились. Рассчитайте распределение заново");
          }
          await tx.settlement.create({
            data: {
              applicationId: row.applicationId,
              bedId: row.bedId,
              assignedById: userId,
              method: "AUTO",
              orderNumber,
              checkInFrom: campaign?.checkInFrom,
              checkInUntil: campaign?.checkInUntil,
              runId: run.id,
            },
          });
          await tx.application.update({
            where: { id: row.applicationId },
            data: { status: "SETTLED" },
          });
          await notify(
            tx,
            row.userId,
            "Назначено место в общежитии",
            `${row.buildingName}, комната ${row.roomNumber}, койка ${row.bedNumber}. Направление ${orderNumber}.`,
          );
        } else if (row.outcome === "WAITLIST") {
          const current = await tx.application.findUnique({ where: { id: row.applicationId } });
          await tx.application.update({
            where: { id: row.applicationId },
            data: { status: "WAITLIST" },
          });
          if (current?.status !== "WAITLIST") {
            await notify(tx, row.userId, "Вы в очереди на заселение", row.reason);
          }
        }
      }

      await writeAudit(tx, userId, "Автозаселение", "SettlementRun", run.id, {
        groupByFaculty,
        settledCount: summary.settledCount,
        waitlistCount: summary.waitlistCount,
        skippedCount: summary.skippedCount,
      });

      return { runId: run.id, ...summary };
    },
    { timeout: 30000 },
  );
}

async function loadAssignable(tx: Prisma.TransactionClient, applicationId: string) {
  const application = await tx.application.findUnique({
    where: { id: applicationId },
    include: { applicant: { include: { user: true } }, settlement: true, documents: true },
  });
  if (!application) throw new HttpError(404, "Заявка не найдена");
  if (!["APPROVED", "WAITLIST"].includes(application.status) || application.settlement) {
    throw new HttpError(400, "Назначить место можно допущенной заявке без койки");
  }
  const person = application.applicant;
  if (person.gender !== "MALE" && person.gender !== "FEMALE") {
    throw new HttpError(400, "В анкете не указан пол");
  }
  const missing = missingDocumentLabels(
    person.priorityCategory,
    application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type),
  );
  if (missing.length > 0) {
    throw new HttpError(400, `Не проверены документы: ${missing.join(", ")}`);
  }
  return application;
}

async function takeBed(tx: Prisma.TransactionClient, bedId: string, gender: "MALE" | "FEMALE") {
  const bed = await tx.bed.findUnique({
    where: { id: bedId },
    include: { room: { include: { building: true } } },
  });
  if (!bed || bed.status !== "FREE") throw new HttpError(400, "Койка недоступна");
  if (bed.room.status !== "ACTIVE") throw new HttpError(400, "Комната закрыта");
  if (bed.room.gender !== gender) throw new HttpError(400, "Пол комнаты не совпадает с анкетой");
  const occupied = await tx.bed.updateMany({
    where: { id: bedId, status: "FREE" },
    data: { status: "OCCUPIED" },
  });
  if (occupied.count !== 1) throw new HttpError(409, "Койку уже заняли");
  return bed;
}

export async function assignManually(userId: string, applicationId: string, bedId: string) {
  return prisma.$transaction(async (tx) => {
    const application = await loadAssignable(tx, applicationId);
    const gender = application.applicant.gender as "MALE" | "FEMALE";
    const bed = await takeBed(tx, bedId, gender);
    const campaign = await tx.campaign.findUnique({ where: { id: "default" } });
    const orderNumber = await nextOrderNumber(tx);
    const settlement = await tx.settlement.create({
      data: {
        applicationId,
        bedId,
        assignedById: userId,
        method: "MANUAL",
        orderNumber,
        checkInFrom: campaign?.checkInFrom,
        checkInUntil: campaign?.checkInUntil,
      },
    });
    await tx.application.update({ where: { id: applicationId }, data: { status: "SETTLED" } });
    await notify(
      tx,
      application.applicant.userId,
      "Назначено место в общежитии",
      `${bed.room.building.name}, комната ${bed.room.number}, койка ${bed.number}. Направление ${orderNumber}.`,
    );
    await writeAudit(tx, userId, "Ручное назначение", "Settlement", settlement.id, {
      name: fullName(application.applicant),
      building: bed.room.building.name,
      room: bed.room.number,
      bed: bed.number,
    });
    return settlement;
  });
}

export async function moveSettlement(userId: string, settlementId: string, bedId: string) {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId },
      include: { application: { include: { applicant: true } }, bed: true },
    });
    if (!settlement) throw new HttpError(404, "Назначение не найдено");
    if (settlement.bedId === bedId) throw new HttpError(400, "Это та же койка");
    const gender = settlement.application.applicant.gender;
    if (gender !== "MALE" && gender !== "FEMALE") throw new HttpError(400, "В анкете не указан пол");
    const bed = await takeBed(tx, bedId, gender);
    await tx.bed.update({ where: { id: settlement.bedId }, data: { status: "FREE" } });
    const updated = await tx.settlement.update({
      where: { id: settlementId },
      data: { bedId, method: "MANUAL", assignedById: userId },
    });
    await notify(
      tx,
      settlement.application.applicant.userId,
      "Место в общежитии изменено",
      `${bed.room.building.name}, комната ${bed.room.number}, койка ${bed.number}. Направление ${settlement.orderNumber}.`,
    );
    await writeAudit(tx, userId, "Переселение", "Settlement", settlement.id, {
      name: fullName(settlement.application.applicant),
      building: bed.room.building.name,
      room: bed.room.number,
      bed: bed.number,
    });
    return updated;
  });
}

export async function unassignSettlement(userId: string, settlementId: string) {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({
      where: { id: settlementId },
      include: { application: { include: { applicant: true } } },
    });
    if (!settlement) throw new HttpError(404, "Назначение не найдено");
    await tx.bed.update({ where: { id: settlement.bedId }, data: { status: "FREE" } });
    await tx.application.update({ where: { id: settlement.applicationId }, data: { status: "APPROVED" } });
    await tx.settlement.delete({ where: { id: settlementId } });
    await notify(
      tx,
      settlement.application.applicant.userId,
      "Назначение места отменено",
      `Направление ${settlement.orderNumber} отозвано. Заявка снова в статусе «Допуск».`,
    );
    await writeAudit(tx, userId, "Снятие с места", "Settlement", settlementId, {
      name: fullName(settlement.application.applicant),
      orderNumber: settlement.orderNumber,
    });
  });
}

export type AppDb = PrismaClient;
