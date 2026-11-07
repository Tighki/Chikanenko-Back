import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildSettlementPlan, type PlanApplicant, type PlanBed, type PlanRow } from "../domain/settlementPlan.js";
import { CATEGORY_TITLES, fullName, missingDocumentLabels } from "../domain/labels.js";
import { writeAudit, type Db } from "./audit.js";
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
        } else if (row.outcome === "WAITLIST") {
          await tx.application.update({
            where: { id: row.applicationId },
            data: { status: "WAITLIST" },
          });
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

type LayoutBed = {
  id?: string;
  number: number;
  blocked: boolean;
  applicationId: string | null;
};

type LayoutRoom = {
  id?: string;
  number: string;
  floor: number;
  gender: "MALE" | "FEMALE";
  accessible: boolean;
  closed: boolean;
  beds: LayoutBed[];
};

export async function saveHousingLayout(userId: string, buildingId: string, rooms: LayoutRoom[]) {
  const roomNumbers = rooms.map((room) => room.number);
  if (new Set(roomNumbers).size !== roomNumbers.length) {
    throw new HttpError(400, "Номера комнат не должны повторяться");
  }
  const wantedApplications = new Map<string, { roomNumber: string; bedNumber: number; gender: "MALE" | "FEMALE"; closed: boolean; blocked: boolean }>();
  for (const room of rooms) {
    const bedNumbers = new Set<number>();
    for (const bed of room.beds) {
      if (bedNumbers.has(bed.number)) throw new HttpError(400, `В комнате ${room.number} повторяется номер койки`);
      bedNumbers.add(bed.number);
      if (!bed.applicationId) continue;
      if (wantedApplications.has(bed.applicationId)) throw new HttpError(400, "Студент указан сразу на двух койках");
      if (room.closed) throw new HttpError(400, `Комната ${room.number} закрыта, на неё нельзя заселять`);
      if (bed.blocked) throw new HttpError(400, `Койка ${bed.number} в комнате ${room.number} заблокирована`);
      wantedApplications.set(bed.applicationId, {
        roomNumber: room.number,
        bedNumber: bed.number,
        gender: room.gender,
        closed: room.closed,
        blocked: bed.blocked,
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    const building = await tx.building.findUnique({
      where: { id: buildingId },
      include: { rooms: { include: { beds: { include: { settlement: true } } } } },
    });
    if (!building) throw new HttpError(404, "Корпус не найден");

    const applications = wantedApplications.size
      ? await tx.application.findMany({
          where: { id: { in: [...wantedApplications.keys()] } },
          include: {
            applicant: true,
            documents: true,
            settlement: { include: { bed: { include: { room: true } } } },
          },
        })
      : [];
    if (applications.length !== wantedApplications.size) throw new HttpError(400, "В списке есть неизвестная заявка");

    const keptOrders = new Map<string, string>();
    for (const application of applications) {
      const target = wantedApplications.get(application.id)!;
      const gender = application.applicant.gender;
      if (gender !== "MALE" && gender !== "FEMALE") throw new HttpError(400, `У ${fullName(application.applicant)} не указан пол`);
      if (gender !== target.gender) {
        throw new HttpError(400, `${fullName(application.applicant)} не подходит в комнату ${target.roomNumber}: другой пол`);
      }
      const settlement = application.settlement;
      if (settlement && settlement.bed.room.buildingId !== buildingId) {
        throw new HttpError(400, `${fullName(application.applicant)} уже заселён в другом корпусе`);
      }
      if (!settlement) {
        if (!["APPROVED", "WAITLIST"].includes(application.status)) {
          throw new HttpError(400, `${fullName(application.applicant)} ещё не допущен к заселению`);
        }
        const missing = missingDocumentLabels(
          application.applicant.priorityCategory,
          application.documents.filter((doc) => doc.status === "VERIFIED").map((doc) => doc.type),
        );
        if (missing.length > 0) throw new HttpError(400, `${fullName(application.applicant)}: не проверены документы: ${missing.join(", ")}`);
      } else {
        keptOrders.set(application.id, settlement.orderNumber);
      }
    }

    const currentBeds = building.rooms.flatMap((room) => room.beds);
    const stayBedByApplication = new Map<string, string>();
    for (const room of rooms) {
      for (const bed of room.beds) {
        if (!bed.id || !bed.applicationId) continue;
        const current = currentBeds.find((item) => item.id === bed.id);
        if (current?.settlement?.applicationId === bed.applicationId) stayBedByApplication.set(bed.applicationId, bed.id);
      }
    }

    for (const bed of currentBeds) {
      const settlement = bed.settlement;
      if (!settlement) continue;
      if (stayBedByApplication.get(settlement.applicationId) === bed.id) continue;
      await tx.bed.update({ where: { id: bed.id }, data: { status: "FREE" } });
      await tx.application.update({ where: { id: settlement.applicationId }, data: { status: "APPROVED" } });
      await tx.settlement.delete({ where: { id: settlement.id } });
    }

    const keepRoomIds = new Set(rooms.flatMap((room) => (room.id ? [room.id] : [])));
    const keepBedIds = new Set(rooms.flatMap((room) => room.beds.flatMap((bed) => (bed.id ? [bed.id] : []))));
    for (const room of building.rooms) {
      if (!keepRoomIds.has(room.id)) {
        await tx.room.delete({ where: { id: room.id } });
        continue;
      }
      for (const bed of room.beds) {
        if (!keepBedIds.has(bed.id)) await tx.bed.delete({ where: { id: bed.id } });
      }
    }

    for (const room of rooms) {
      if (!room.id) continue;
      await tx.room.update({
        where: { id: room.id },
        data: {
          number: room.number,
          floor: room.floor,
          gender: room.gender,
          accessible: room.accessible,
          status: room.closed ? "CLOSED" : "ACTIVE",
        },
      });
      for (const bed of room.beds) {
        if (!bed.id) {
          await tx.bed.create({
            data: { roomId: room.id, number: bed.number, status: bed.blocked ? "BLOCKED" : "FREE" },
          });
        } else if (!stayBedByApplication.has(bed.applicationId ?? "")) {
          await tx.bed.update({
            where: { id: bed.id },
            data: { number: bed.number, status: bed.blocked ? "BLOCKED" : "FREE" },
          });
        }
      }
    }

    for (const room of rooms) {
      if (room.id) continue;
      await tx.room.create({
        data: {
          buildingId,
          number: room.number,
          floor: room.floor,
          gender: room.gender,
          accessible: room.accessible,
          status: room.closed ? "CLOSED" : "ACTIVE",
          beds: {
            create: room.beds.map((bed) => ({
              number: bed.number,
              status: bed.blocked ? "BLOCKED" : "FREE",
            })),
          },
        },
      });
    }

    const freshBeds = await tx.bed.findMany({
      where: { room: { buildingId } },
      include: { room: true },
    });
    const bedByPlace = new Map(freshBeds.map((bed) => [`${bed.room.number}#${bed.number}`, bed]));
    const campaign = await tx.campaign.findUnique({ where: { id: "default" } });

    const orderedApplications = [...applications].sort(
      (left, right) => Number(keptOrders.has(right.id)) - Number(keptOrders.has(left.id)),
    );
    for (const application of orderedApplications) {
      if (stayBedByApplication.has(application.id)) continue;
      const target = wantedApplications.get(application.id)!;
      const bed = bedByPlace.get(`${target.roomNumber}#${target.bedNumber}`);
      if (!bed) throw new HttpError(400, `Не найдена койка ${target.bedNumber} в комнате ${target.roomNumber}`);
      const gender = application.applicant.gender as "MALE" | "FEMALE";
      await takeBed(tx, bed.id, gender);
      const orderNumber = keptOrders.get(application.id) ?? (await nextOrderNumber(tx));
      const settlement = await tx.settlement.create({
        data: {
          applicationId: application.id,
          bedId: bed.id,
          assignedById: userId,
          method: "MANUAL",
          orderNumber,
          checkInFrom: campaign?.checkInFrom,
          checkInUntil: campaign?.checkInUntil,
        },
      });
      await tx.application.update({ where: { id: application.id }, data: { status: "SETTLED" } });
      await writeAudit(tx, userId, keptOrders.has(application.id) ? "Переселение" : "Ручное назначение", "Settlement", settlement.id, {
        name: fullName(application.applicant),
        building: building.name,
        room: bed.room.number,
        bed: bed.number,
      });
    }

    const removed = [...building.rooms.flatMap((room) => room.beds.flatMap((bed) => (bed.settlement ? [bed.settlement] : [])))]
      .filter((settlement) => !wantedApplications.has(settlement.applicationId));
    for (const settlement of removed) {
      const application = await tx.application.findUnique({
        where: { id: settlement.applicationId },
        include: { applicant: true },
      });
      if (!application) continue;
      await writeAudit(tx, userId, "Снятие с места", "Settlement", settlement.id, {
        name: fullName(application.applicant),
        orderNumber: settlement.orderNumber,
      });
    }

    await writeAudit(tx, userId, "Правка жилого фонда", "Building", buildingId, {
      rooms: rooms.length,
      beds: rooms.reduce((sum, room) => sum + room.beds.length, 0),
    });
  }, { timeout: 30000 });
}

export type AppDb = PrismaClient;
