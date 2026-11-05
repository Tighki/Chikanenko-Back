import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient, type DocumentType, type PriorityCategory } from "@prisma/client";
import { config } from "../src/config.ts";
import { distanceKmFromCity } from "../src/domain/distance.ts";
import { DOCUMENT_LABELS } from "../src/domain/labels.ts";

const prisma = new PrismaClient();

type SeedPerson = {
  email: string;
  lastName: string;
  firstName: string;
  middleName: string;
  gender: "MALE" | "FEMALE";
  city: string;
  region: string;
  faculty: string;
  specialty: string;
  score: number;
  category: PriorityCategory;
  birth: string;
  phone: string;
  status: "APPROVED" | "SUBMITTED";
  socialDoc?: "LARGE_FAMILY" | "LOW_INCOME";
};

const homes: Record<string, { street: string; house: string; apartment: string }> = {
  Казань: { street: "ул. Баумана", house: "15", apartment: "8" },
  Орёл: { street: "ул. Ленина", house: "22", apartment: "3" },
  Самара: { street: "ул. Молодогвардейская", house: "151", apartment: "12" },
  Воронеж: { street: "пр-т Революции", house: "18", apartment: "5" },
  Пенза: { street: "ул. Московская", house: "73", apartment: "2" },
  Рязань: { street: "ул. Почтовая", house: "51", apartment: "9" },
  Белгород: { street: "пр-т Славы", house: "40", apartment: "16" },
  Тамбов: { street: "ул. Советская", house: "112", apartment: "7" },
  Ярославль: { street: "ул. Свободы", house: "20", apartment: "4" },
  Кострома: { street: "пр-т Мира", house: "6", apartment: "11" },
  Владимир: { street: "ул. Большая Московская", house: "33", apartment: "1" },
  Иваново: { street: "пр-т Ленина", house: "94", apartment: "18" },
  Тверь: { street: "ул. Советская", house: "14", apartment: "6" },
  Курск: { street: "ул. Ленина", house: "67", apartment: "10" },
  Брянск: { street: "пр-т Ленина", house: "29", apartment: "3" },
};

const it = "Институт информационных технологий";
const econ = "Институт экономики и управления";
const build = "Институт строительства";

const people: SeedPerson[] = [
  person("sokolov", "Соколов", "Артём", "Игоревич", "MALE", "Казань", "Республика Татарстан", it, "Программная инженерия", 245, "ORPHAN", "2008-04-12", "APPROVED"),
  person("morozov", "Морозов", "Илья", "Сергеевич", "MALE", "Орёл", "Орловская область", it, "Программная инженерия", 198, "DISABILITY", "2008-01-20", "APPROVED"),
  person("volkov", "Волков", "Денис", "Павлович", "MALE", "Самара", "Самарская область", econ, "Менеджмент", 230, "SOCIAL", "2007-11-02", "APPROVED", "LARGE_FAMILY"),
  person("kuznetsov", "Кузнецов", "Павел", "Андреевич", "MALE", "Воронеж", "Воронежская область", it, "Программная инженерия", 260, "OUT_OF_TOWN", "2008-06-18", "APPROVED"),
  person("novikov", "Новиков", "Глеб", "Олегович", "MALE", "Пенза", "Пензенская область", build, "Промышленное и гражданское строительство", 210, "OUT_OF_TOWN", "2008-03-09", "APPROVED"),
  person("orlov", "Орлов", "Никита", "Романович", "MALE", "Рязань", "Рязанская область", it, "Информационная безопасность", 190, "NONE", "2008-08-30", "APPROVED"),
  person("lebedev", "Лебедев", "Максим", "Дмитриевич", "MALE", "Белгород", "Белгородская область", econ, "Экономика", 275, "OUT_OF_TOWN", "2007-12-14", "APPROVED"),
  person("fedorov", "Фёдоров", "Кирилл", "Алексеевич", "MALE", "Тамбов", "Тамбовская область", build, "Промышленное и гражданское строительство", 205, "SOCIAL", "2008-02-25", "APPROVED", "LOW_INCOME"),
  person("ivanova", "Иванова", "Мария", "Викторовна", "FEMALE", "Ярославль", "Ярославская область", econ, "Экономика", 255, "ORPHAN", "2008-05-03", "APPROVED"),
  person("smirnova", "Смирнова", "Анна", "Евгеньевна", "FEMALE", "Кострома", "Костромская область", it, "Программная инженерия", 188, "DISABILITY", "2008-09-11", "APPROVED"),
  person("kuznetsova", "Кузнецова", "Елена", "Игоревна", "FEMALE", "Владимир", "Владимирская область", it, "Программная инженерия", 270, "OUT_OF_TOWN", "2008-07-22", "APPROVED"),
  person("popova", "Попова", "Дарья", "Николаевна", "FEMALE", "Иваново", "Ивановская область", econ, "Менеджмент", 220, "SOCIAL", "2008-01-08", "APPROVED", "LARGE_FAMILY"),
  person("vasileva", "Васильева", "Ольга", "Петровна", "FEMALE", "Тверь", "Тверская область", build, "Промышленное и гражданское строительство", 240, "OUT_OF_TOWN", "2007-10-19", "APPROVED"),
  person("egorov", "Егоров", "Роман", "Станиславович", "MALE", "Курск", "Курская область", it, "Программная инженерия", 222, "OUT_OF_TOWN", "2008-04-28", "SUBMITTED"),
  person("belova", "Белова", "Кира", "Андреевна", "FEMALE", "Брянск", "Брянская область", econ, "Экономика", 231, "SOCIAL", "2008-06-02", "SUBMITTED", "LARGE_FAMILY"),
];

function person(
  email: string,
  lastName: string,
  firstName: string,
  middleName: string,
  gender: "MALE" | "FEMALE",
  city: string,
  region: string,
  faculty: string,
  specialty: string,
  score: number,
  category: PriorityCategory,
  birth: string,
  status: "APPROVED" | "SUBMITTED",
  socialDoc?: "LARGE_FAMILY" | "LOW_INCOME",
): SeedPerson {
  return { email: `${email}@hostel.local`, lastName, firstName, middleName, gender, city, region, faculty, specialty, score, category, birth, phone: "+7 900 000-00-00", status, socialDoc };
}

function documentTypes(item: SeedPerson): DocumentType[] {
  const types: DocumentType[] = ["PASSPORT"];
  if (item.category === "ORPHAN") types.push("ORPHAN");
  if (item.category === "DISABILITY") types.push("DISABILITY");
  if (item.category === "SOCIAL") types.push(item.socialDoc ?? "LARGE_FAMILY");
  if (item.category === "OUT_OF_TOWN") types.push("REGISTRATION");
  return types;
}

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
  const studentHash = await bcrypt.hash("Student123", 10);

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

  const rules: { category: PriorityCategory; rank: number; title: string }[] = [
    { category: "ORPHAN", rank: 1, title: "Дети-сироты и дети, оставшиеся без попечения родителей" },
    { category: "DISABILITY", rank: 2, title: "Инвалиды I и II группы, дети-инвалиды" },
    { category: "SOCIAL", rank: 3, title: "Из многодетных и малоимущих семей" },
    { category: "OUT_OF_TOWN", rank: 4, title: "Иногородние" },
    { category: "NONE", rank: 5, title: "Без льготы" },
  ];
  await prisma.priorityRule.createMany({ data: rules });

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

  for (const [index, item] of people.entries()) {
    const user = await prisma.user.create({
      data: {
        email: item.email,
        passwordHash: studentHash,
        role: "APPLICANT",
        fullName: `${item.lastName} ${item.firstName} ${item.middleName}`,
        phone: item.phone,
        applicant: {
          create: {
            lastName: item.lastName,
            firstName: item.firstName,
            middleName: item.middleName,
            birthDate: new Date(`${item.birth}T00:00:00`),
            gender: item.gender,
            city: item.city,
            region: item.region,
            street: homes[item.city]?.street ?? "",
            house: homes[item.city]?.house ?? "",
            apartment: homes[item.city]?.apartment ?? "",
            distanceKm: distanceKmFromCity(item.city),
            faculty: item.faculty,
            specialty: item.specialty,
            admissionScore: item.score,
            priorityCategory: item.category,
            imported: true,
            application: {
              create: {
                status: item.status,
                submittedAt: new Date(Date.UTC(2026, 6, 1, 8, index * 5)),
                comment: "Прошу предоставить место в общежитии на время обучения.",
              },
            },
          },
        },
      },
      include: { applicant: { include: { application: true } } },
    });

    const applicationId = user.applicant!.application!.id;
    for (const type of documentTypes(item)) {
      const storedName = `seed-${user.applicant!.id}-${type}.txt`;
      const originalName = `${DOCUMENT_LABELS[type]}.txt`;
      fs.writeFileSync(
        path.join(config.uploadDir, storedName),
        `${DOCUMENT_LABELS[type]}\n${user.fullName}\nДемонстрационный файл для защиты диплома.\n`,
        "utf8",
      );
      await prisma.document.create({
        data: {
          applicationId,
          type,
          originalName,
          storedName,
          status: item.status === "APPROVED" ? "VERIFIED" : "PENDING",
          reviewedById: item.status === "APPROVED" ? staff.id : null,
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: staff.id,
      action: "Подготовка демонстрационных данных",
      entity: "Campaign",
      entityId: "default",
      details: { applicants: people.length },
    },
  });

  console.log("Сид готов.");
  console.log("Администратор: admin@hostel.local / Admin123");
  console.log("Сотрудник: staff@hostel.local / Staff123");
  console.log("Абитуриент: sokolov@hostel.local / Student123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
