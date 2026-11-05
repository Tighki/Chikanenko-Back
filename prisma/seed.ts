import fs from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { config } from "../src/config.ts";

const prisma = new PrismaClient();

async function clear() {
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.settlementRun.deleteMany();
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.bed.deleteMany();
  await prisma.room.deleteMany();
  await prisma.building.deleteMany();
  await prisma.applicant.deleteMany();
  await prisma.user.deleteMany();
  await prisma.priorityRule.deleteMany();
  await prisma.campaign.deleteMany();
}

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await clear();

  const adminHash = await bcrypt.hash("Admin123", 10);
  const staffHash = await bcrypt.hash("Staff123", 10);

  await prisma.user.create({
    data: {
      email: "admin@hostel.local",
      passwordHash: adminHash,
      role: "ADMIN",
      fullName: "Павлов Сергей Андреевич",
      phone: "+7 900 100-00-01",
    },
  });
  const staff = await prisma.user.create({
    data: {
      email: "staff@hostel.local",
      passwordHash: staffHash,
      role: "STAFF",
      fullName: "Ковалёва Наталья Сергеевна",
      phone: "+7 900 100-00-02",
    },
  });

  await prisma.campaign.create({
    data: {
      id: "default",
      name: "Заселение абитуриентов 2026",
      startsAt: new Date("2026-01-01T00:00:00"),
      endsAt: new Date("2026-12-31T23:59:59"),
      checkInFrom: new Date("2026-08-25T00:00:00"),
      checkInUntil: new Date("2026-09-05T23:59:59"),
      active: true,
    },
  });

  await prisma.priorityRule.createMany({
    data: [
      { category: "ORPHAN", rank: 1, title: "Дети-сироты и дети, оставшиеся без попечения родителей" },
      { category: "DISABILITY", rank: 2, title: "Инвалиды I и II группы, дети-инвалиды" },
      { category: "SOCIAL", rank: 3, title: "Из многодетных и малоимущих семей" },
      { category: "OUT_OF_TOWN", rank: 4, title: "Иногородние" },
      { category: "NONE", rank: 5, title: "Без льготы" },
    ],
  });

  const north = await prisma.building.create({
    data: { name: "Корпус «Северный»", address: "ул. Студенческая, 12", gender: "MALE" },
  });
  const south = await prisma.building.create({
    data: { name: "Корпус «Южный»", address: "ул. Студенческая, 14", gender: "FEMALE" },
  });

  async function addRoom(buildingId: string, gender: "MALE" | "FEMALE", number: string, floor: number, accessible: boolean, beds: number) {
    await prisma.room.create({
      data: {
        buildingId,
        gender,
        number,
        floor,
        accessible,
        beds: { create: Array.from({ length: beds }, (_, index) => ({ number: index + 1 })) },
      },
    });
  }

  await addRoom(north.id, "MALE", "101", 1, true, 2);
  await addRoom(north.id, "MALE", "102", 1, false, 2);
  await addRoom(north.id, "MALE", "201", 2, false, 2);
  await addRoom(south.id, "FEMALE", "101", 1, true, 2);
  await addRoom(south.id, "FEMALE", "102", 1, false, 2);

  await prisma.auditLog.create({
    data: {
      userId: staff.id,
      action: "Подготовка демонстрационных данных",
      entity: "Campaign",
      entityId: "default",
    },
  });

  console.log("Сид готов.");
  console.log("Администратор: admin@hostel.local / Admin123");
  console.log("Сотрудник: staff@hostel.local / Staff123");
  console.log("Студентов в сиде нет: их загружает сотрудник файлом.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
