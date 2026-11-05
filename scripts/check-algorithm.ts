import assert from "node:assert/strict";
import { buildSettlementPlan, type PlanApplicant, type PlanBed } from "../src/domain/settlementPlan.ts";

function applicant(partial: Partial<PlanApplicant> & Pick<PlanApplicant, "applicationId" | "fullName" | "category" | "score" | "priorityRank" | "gender">): PlanApplicant {
  return {
    userId: partial.applicationId,
    faculty: partial.faculty ?? "ИТ",
    categoryTitle: partial.category,
    submittedAt: partial.submittedAt ?? new Date("2026-07-01T10:00:00Z"),
    needsAccessible: partial.category === "DISABILITY",
    documentsOk: partial.documentsOk ?? true,
    ...partial,
  };
}

function bed(partial: Partial<PlanBed> & Pick<PlanBed, "id" | "gender">): PlanBed {
  return {
    number: partial.number ?? 1,
    roomId: partial.roomId ?? "r1",
    roomNumber: partial.roomNumber ?? "101",
    floor: partial.floor ?? 1,
    accessible: partial.accessible ?? false,
    roomActive: partial.roomActive ?? true,
    buildingName: partial.buildingName ?? "Северный",
    occupiedFaculties: partial.occupiedFaculties ?? [],
    ...partial,
  };
}

const orphan = applicant({
  applicationId: "orphan",
  fullName: "Соколов Артём",
  category: "ORPHAN",
  score: 200,
  priorityRank: 1,
  gender: "MALE",
});

const disabled = applicant({
  applicationId: "disabled",
  fullName: "Морозов Илья",
  category: "DISABILITY",
  score: 150,
  priorityRank: 2,
  gender: "MALE",
  faculty: "Экономика",
});

const highScore = applicant({
  applicationId: "score",
  fullName: "Лебедев Максим",
  category: "OUT_OF_TOWN",
  score: 280,
  priorityRank: 4,
  gender: "MALE",
});

const female = applicant({
  applicationId: "female",
  fullName: "Иванова Мария",
  category: "ORPHAN",
  score: 260,
  priorityRank: 1,
  gender: "FEMALE",
  faculty: "Экономика",
});

const beds: PlanBed[] = [
  bed({ id: "acc", gender: "MALE", accessible: true, roomId: "acc", roomNumber: "101" }),
  bed({ id: "reg", gender: "MALE", accessible: false, roomId: "reg", roomNumber: "102", number: 1 }),
  bed({ id: "f", gender: "FEMALE", accessible: false, roomId: "f", roomNumber: "101", buildingName: "Южный" }),
];

const plan = buildSettlementPlan([highScore, disabled, female, orphan], beds, { groupByFaculty: false });
const byId = Object.fromEntries(plan.map((row) => [row.applicationId, row]));

assert.deepEqual(
  plan.map((row) => row.applicationId),
  ["female", "orphan", "disabled", "score"],
  "при равной льготе выше балл, льгота важнее чужого высокого балла",
);
assert.equal(byId.orphan.bedId, "reg", "без инвалидности обычная койка раньше доступной среды");
assert.equal(byId.disabled.bedId, "acc", "инвалидность получает доступную среду");
assert.equal(byId.female.bedId, "f", "женский фонд отдельно");
assert.equal(byId.score.outcome, "WAITLIST");

const onlyAccessible = buildSettlementPlan(
  [applicant({ applicationId: "plain", fullName: "Орлов", category: "NONE", score: 100, priorityRank: 5, gender: "MALE" })],
  [bed({ id: "only-acc", gender: "MALE", accessible: true })],
  { groupByFaculty: false },
);
assert.equal(onlyAccessible[0].bedId, "only-acc", "обычный претендент берёт доступную среду, если обычных мест нет");

const closed = buildSettlementPlan(
  [orphan],
  [bed({ id: "closed", gender: "MALE", roomActive: false })],
  { groupByFaculty: false },
);
assert.equal(closed[0].outcome, "WAITLIST");

const skipped = buildSettlementPlan(
  [{ ...orphan, documentsOk: false, documentProblem: "Нет паспорта" }],
  beds,
  { groupByFaculty: false },
);
assert.equal(skipped[0].outcome, "SKIPPED");
assert.equal(skipped[0].reason, "Нет паспорта");

const itFirst = applicant({
  applicationId: "it",
  fullName: "Кузнецов",
  category: "OUT_OF_TOWN",
  score: 10,
  priorityRank: 4,
  gender: "MALE",
  faculty: "ИТ",
  submittedAt: new Date("2026-07-01T08:00:00Z"),
});
const econ = applicant({
  applicationId: "econ",
  fullName: "Волков",
  category: "OUT_OF_TOWN",
  score: 10,
  priorityRank: 4,
  gender: "MALE",
  faculty: "Экономика",
  submittedAt: new Date("2026-07-01T09:00:00Z"),
});
const grouped = buildSettlementPlan(
  [itFirst, econ],
  [
    bed({ id: "a1", gender: "MALE", roomId: "room-a", roomNumber: "201", number: 1, occupiedFaculties: ["Экономика"] }),
    bed({ id: "b1", gender: "MALE", roomId: "room-b", roomNumber: "102", number: 1 }),
  ],
  { groupByFaculty: true },
);
assert.equal(grouped[0].bedId, "b1", "пустая комната лучше чужого факультета");
assert.equal(grouped[1].bedId, "a1", "второй идёт в комнату своего факультета");

const sameFaculty = buildSettlementPlan(
  [
    applicant({ applicationId: "p1", fullName: "А", category: "NONE", score: 2, priorityRank: 5, gender: "MALE", faculty: "ИТ", submittedAt: new Date("2026-07-01T08:00:00Z") }),
    applicant({ applicationId: "p2", fullName: "Б", category: "NONE", score: 1, priorityRank: 5, gender: "MALE", faculty: "ИТ", submittedAt: new Date("2026-07-01T09:00:00Z") }),
  ],
  [
    bed({ id: "s1", gender: "MALE", roomId: "shared", roomNumber: "102", number: 1 }),
    bed({ id: "s2", gender: "MALE", roomId: "shared", roomNumber: "102", number: 2 }),
    bed({ id: "o1", gender: "MALE", roomId: "other", roomNumber: "201", number: 1 }),
  ],
  { groupByFaculty: true },
);
assert.equal(sameFaculty[0].bedId, "s1");
assert.equal(sameFaculty[1].bedId, "s2", "второй того же факультета садится в ту же комнату");

console.log("Алгоритм автозаселения: проверки пройдены");
