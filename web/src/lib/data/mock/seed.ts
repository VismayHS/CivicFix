import type {
  Category,
  ComplaintStatus,
  Department,
  NotificationType,
  Priority,
  ReviewStatus,
  Role,
  Ward,
} from "../../types";

/**
 * Deterministic mock dataset. Same seed → same data on every restart, so demo
 * accounts always have something to show. Times are relative to server start.
 * The SQL seed in db/seed/ mirrors the reference data (wards, departments,
 * categories, demo users) one to one.
 */

export interface UserRow {
  userId: number;
  name: string;
  email: string;
  password: string;
  role: Role;
  departmentId: number | null;
  wardId: number | null;
  supervisorId: number | null;
  isActive: boolean;
  phones: string[];
  createdAt: number;
}

export interface ComplaintRow {
  complaintId: number;
  title: string;
  description: string;
  categoryId: number;
  departmentId: number;
  wardId: number;
  status: ComplaintStatus;
  priority: Priority;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: number;
  updatedAt: number;
  slaDeadline: number;
  resolvedAt: number | null;
  filedBy: number;
  assignedTo: number | null;
  duplicateOf: number | null;
}

export interface HistoryRow {
  complaintId: number;
  historyNo: number;
  oldStatus: ComplaintStatus | null;
  newStatus: ComplaintStatus;
  /** null = automated (trigger / pg_cron) */
  changedBy: number | null;
  remarks: string | null;
  changedAt: number;
}

export interface EscalationRow {
  complaintId: number;
  level: number;
  escalatedFrom: number | null;
  escalatedTo: number;
  reason: string;
  escalatedAt: number;
  resolvedAt: number | null;
}

export interface UpvoteRow {
  complaintId: number;
  userId: number;
  upvotedAt: number;
}

export interface MatchRow {
  complaintId: number;
  matchedComplaintId: number;
  score: number;
  reviewStatus: ReviewStatus;
  reviewedBy: number | null;
  detectedAt: number;
  reviewedAt: number | null;
}

export interface NotificationRow {
  notificationId: number;
  userId: number;
  complaintId: number | null;
  type: NotificationType;
  message: string;
  readStatus: boolean;
  sentAt: number;
}

export interface MockDb {
  now: number;
  wards: Ward[];
  departments: Department[];
  categories: Category[];
  users: UserRow[];
  complaints: ComplaintRow[];
  history: HistoryRow[];
  escalations: EscalationRow[];
  upvotes: UpvoteRow[];
  matches: MatchRow[];
  notifications: NotificationRow[];
  sessions: Map<string, number>;
  vectorPayloadPatches: Map<number, Record<string, string | number | boolean | null>>;
  deletedVectorIds: Set<number>;
}

const H = 3_600_000;
const DAY = 24 * H;

// mulberry32: tiny deterministic PRNG
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const WARDS: Ward[] = [
  { wardId: 1, wardNumber: 151, name: "Koramangala", zone: "South-East", population: 63800, latitude: 12.9352, longitude: 77.6245 },
  { wardId: 2, wardNumber: 80, name: "Indiranagar", zone: "East", population: 58200, latitude: 12.9784, longitude: 77.6408 },
  { wardId: 3, wardNumber: 169, name: "Jayanagar", zone: "South", population: 54100, latitude: 12.9308, longitude: 77.5838 },
  { wardId: 4, wardNumber: 45, name: "Malleshwaram", zone: "West", population: 49600, latitude: 13.0035, longitude: 77.5709 },
  { wardId: 5, wardNumber: 84, name: "Whitefield", zone: "Mahadevapura", population: 71400, latitude: 12.9698, longitude: 77.75 },
  { wardId: 6, wardNumber: 174, name: "HSR Layout", zone: "Bommanahalli", population: 66300, latitude: 12.9116, longitude: 77.6474 },
  { wardId: 7, wardNumber: 99, name: "Rajajinagar", zone: "West", population: 52700, latitude: 12.991, longitude: 77.552 },
  { wardId: 8, wardNumber: 23, name: "Hebbal", zone: "North", population: 47900, latitude: 13.0358, longitude: 77.597 },
  { wardId: 9, wardNumber: 176, name: "BTM Layout", zone: "Bommanahalli", population: 69800, latitude: 12.9166, longitude: 77.6101 },
  { wardId: 10, wardNumber: 154, name: "Basavanagudi", zone: "South", population: 45200, latitude: 12.9406, longitude: 77.5738 },
];

export const DEPARTMENTS: Department[] = [
  { departmentId: 1, name: "Roads & Infrastructure", contactEmail: "roads@civicfix.test", description: "Road surfaces, footpaths, medians and junction repairs." },
  { departmentId: 2, name: "Solid Waste Management", contactEmail: "swm@civicfix.test", description: "Door-to-door collection, black spots and illegal dumping." },
  { departmentId: 3, name: "Water Supply & Sewerage", contactEmail: "water@civicfix.test", description: "Pipelines, supply schedules, sewage lines and manholes." },
  { departmentId: 4, name: "Street Lighting", contactEmail: "lighting@civicfix.test", description: "Streetlights, poles and exposed wiring on public land." },
  { departmentId: 5, name: "Storm Water Drains", contactEmail: "swd@civicfix.test", description: "Drains, culverts and waterlogging during rain." },
  { departmentId: 6, name: "Public Health", contactEmail: "health@civicfix.test", description: "Mosquito control, stagnant water and stray animal welfare." },
  { departmentId: 7, name: "Parks & Urban Forestry", contactEmail: "parks@civicfix.test", description: "Parks, playgrounds, tree pruning and fallen trees." },
];

export const CATEGORIES: Category[] = [
  { categoryId: 1, name: "Pothole or damaged road", departmentId: 1, slaHours: 72 },
  { categoryId: 2, name: "Broken footpath", departmentId: 1, slaHours: 120 },
  { categoryId: 3, name: "Garbage not collected", departmentId: 2, slaHours: 24 },
  { categoryId: 4, name: "Illegal dumping", departmentId: 2, slaHours: 48 },
  { categoryId: 5, name: "Water leakage or pipe burst", departmentId: 3, slaHours: 24 },
  { categoryId: 6, name: "No water supply", departmentId: 3, slaHours: 12 },
  { categoryId: 7, name: "Sewage overflow", departmentId: 3, slaHours: 24 },
  { categoryId: 8, name: "Streetlight not working", departmentId: 4, slaHours: 48 },
  { categoryId: 9, name: "Exposed electrical wire", departmentId: 4, slaHours: 12 },
  { categoryId: 10, name: "Blocked storm drain", departmentId: 5, slaHours: 36 },
  { categoryId: 11, name: "Waterlogging", departmentId: 5, slaHours: 24 },
  { categoryId: 12, name: "Mosquito breeding or stagnant water", departmentId: 6, slaHours: 72 },
  { categoryId: 13, name: "Stray animal concern", departmentId: 6, slaHours: 96 },
  { categoryId: 14, name: "Fallen tree or branch", departmentId: 7, slaHours: 12 },
  { categoryId: 15, name: "Park maintenance", departmentId: 7, slaHours: 168 },
];

const PLACES: Record<number, string[]> = {
  1: ["Sony World junction", "80 Feet Road", "5th Block bus stop", "Forum Mall signal"],
  2: ["100 Feet Road", "CMH Road", "12th Main", "Domlur flyover"],
  3: ["4th Block", "11th Main", "Jayanagar Shopping Complex", "South End Circle"],
  4: ["Sampige Road", "8th Cross", "Margosa Road", "18th Cross market"],
  5: ["ITPL Main Road", "Hope Farm junction", "Varthur Road", "Kundalahalli Gate"],
  6: ["27th Main", "Sector 2", "Agara Lake road", "14th Main"],
  7: ["Dr Rajkumar Road", "Navrang theatre", "1st Block", "West of Chord Road"],
  8: ["Hebbal flyover", "Kempapura", "Bellary Road service road", "Hebbal lake gate"],
  9: ["Silk Board junction", "29th Main", "Udupi Garden signal", "BTM 2nd Stage"],
  10: ["Gandhi Bazaar", "Bull Temple Road", "DVG Road", "Lalbagh West Gate"],
};

const TEMPLATES: Record<number, { titles: string[]; descriptions: string[] }> = {
  1: {
    titles: ["Deep pothole near {p}", "Large crater on the road at {p}", "Road surface caved in near {p}"],
    descriptions: [
      "There is a deep pothole in the middle of the road near {p}. Two-wheelers swerve into traffic to avoid it and it fills with water when it rains.",
      "The road has broken up near {p}, leaving a hole almost a metre wide. Vehicles hit it at night because there is no barricade or reflector.",
    ],
  },
  2: {
    titles: ["Broken footpath slabs at {p}", "Footpath tiles missing near {p}"],
    descriptions: [
      "Several footpath slabs are broken or missing near {p}. Pedestrians, especially elderly people, are forced to walk on the road.",
      "The footpath at {p} has open gaps where tiles have come loose. Someone tripped here last week.",
    ],
  },
  3: {
    titles: ["Garbage not collected for days at {p}", "Waste piling up near {p}"],
    descriptions: [
      "Household garbage has not been collected near {p} for three days. Bags are torn open by dogs and the smell is spreading.",
      "The collection vehicle skipped our street at {p}. Waste is piling up at the corner and blocking part of the road.",
    ],
  },
  4: {
    titles: ["Construction debris dumped at {p}", "Illegal dumping on vacant plot near {p}"],
    descriptions: [
      "Someone has dumped construction debris and mixed waste on the roadside near {p}. It is growing every night.",
      "A vacant plot near {p} has become a dumping spot for trucks at night. Plastic and rubble are spilling onto the footpath.",
    ],
  },
  5: {
    titles: ["Water pipe burst at {p}", "Drinking water leaking onto the road at {p}"],
    descriptions: [
      "A water pipeline has burst near {p} and clean water has been flowing onto the road since morning.",
      "There is a continuous leak from the supply line at {p}. The road is flooded and water pressure in nearby houses has dropped.",
    ],
  },
  6: {
    titles: ["No water supply in {p} area", "Water supply stopped near {p}"],
    descriptions: [
      "Houses near {p} have had no water supply for two days and there was no notice about maintenance.",
      "Water has not come in the scheduled slot near {p}. Families are buying tanker water.",
    ],
  },
  7: {
    titles: ["Sewage overflowing at {p}", "Manhole overflowing near {p}"],
    descriptions: [
      "Sewage is overflowing from a manhole near {p} and flowing along the road. The smell is unbearable.",
      "The sewer line near {p} is blocked and dirty water is coming up through the manhole cover.",
    ],
  },
  8: {
    titles: ["Streetlights not working on {p}", "Dark stretch near {p}, lights off"],
    descriptions: [
      "Four streetlights in a row near {p} have not worked for a week. The stretch is completely dark after 7 pm and feels unsafe.",
      "The streetlights near {p} are off every night. Women walking back from the bus stop are avoiding this road.",
    ],
  },
  9: {
    titles: ["Exposed live wire near {p}", "Electric cable hanging low at {p}"],
    descriptions: [
      "An electrical wire from a streetlight pole is hanging open near {p}, at the height children can reach.",
      "A cable is dangling from the pole near {p} and touches the footpath when it is windy. It looks live.",
    ],
  },
  10: {
    titles: ["Storm drain blocked at {p}", "Drain choked with silt near {p}"],
    descriptions: [
      "The storm water drain near {p} is choked with silt and plastic. Water backs up onto the road even in light rain.",
      "The drain cover near {p} is broken and the drain underneath is completely blocked with waste.",
    ],
  },
  11: {
    titles: ["Severe waterlogging at {p}", "Road flooded after rain near {p}"],
    descriptions: [
      "After every rain the road near {p} is under knee-deep water for hours. Vehicles are breaking down in it.",
      "Rainwater collects near {p} and does not drain. Shops and houses on the lower side are getting flooded.",
    ],
  },
  12: {
    titles: ["Stagnant water breeding mosquitoes at {p}", "Mosquito breeding in open site near {p}"],
    descriptions: [
      "Water has been stagnant in an open site near {p} for weeks and mosquitoes are breeding. There have been dengue cases on our street.",
      "Old tyres and containers near {p} are full of rainwater with larvae visible. Please arrange fogging and clearance.",
    ],
  },
  13: {
    titles: ["Injured stray dog near {p}", "Stray dog pack chasing vehicles at {p}"],
    descriptions: [
      "A stray dog near {p} has an injured leg and needs care. It is lying near the bus stop.",
      "A pack of stray dogs near {p} chases two-wheelers at night. Requesting sterilisation and vaccination drive.",
    ],
  },
  14: {
    titles: ["Tree branch fallen on road at {p}", "Fallen tree blocking lane near {p}"],
    descriptions: [
      "A large branch has fallen across the road near {p} after last night's wind and is blocking one lane.",
      "A tree has fallen near {p} and is resting on parked vehicles and the power line. Traffic is diverted.",
    ],
  },
  15: {
    titles: ["Broken swings in park near {p}", "Park lights and benches damaged at {p}"],
    descriptions: [
      "The children's play area in the park near {p} has broken swings and exposed bolts.",
      "Benches and lights in the park near {p} are damaged and the walking track is overgrown.",
    ],
  },
};

const CITIZEN_NAMES = [
  "Ananya Rao", "Karthik Reddy", "Priya Nair", "Mohammed Irfan", "Sneha Kulkarni", "Arjun Shetty",
  "Divya Menon", "Rahul Gowda", "Fatima Begum", "Vikram Joshi", "Nandini Murthy", "Siddharth Bhat",
  "Kavya Srinivas", "Imran Pasha", "Pooja Hegde", "Aditya Prasad", "Lakshmi Narayanan", "Rohan D'Souza",
  "Meghana Patil", "Suresh Babu", "Asha Kumari", "Naveen Raj", "Shalini Verma", "Tejas Rao",
];

const STAFF_NAMES = [
  "Ravi Kumar", "Deepa Shankar", "Manjunath H", "Ayesha Khan", "Prakash Rao", "Shwetha B",
  "Girish Naik", "Rekha Devi", "Santosh Kamath", "Usha Rani", "Harish Gowda", "Bhavana Iyengar",
  "Mahesh Patil", "Sunitha Raj", "Kiran Kumar", "Jyothi M", "Venkatesh Murthy", "Nisha Thomas",
  "Chandru S", "Anitha Krishnan", "Yusuf Ali",
];

const HEAD_NAMES = ["Ramesh Chandra", "Geetha Subramanian", "Abdul Rahman", "Sowmya Rao", "Prasanna Kumar", "Dr. Kavitha Nair", "Anil Hegde"];

function emailFor(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/^dr\.\s*/, "")
      .replace(/'/g, "")
      .replace(/[^a-z\s]/g, "")
      .trim()
      .replace(/\s+/g, ".") + "@civicfix.test"
  );
}

function phoneFor(i: number) {
  return `+9198${String(45000000 + i * 7919).slice(0, 8)}`;
}

export function buildMockDb(now = Date.now()): MockDb {
  const r = rng(20261025);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const PASSWORD = "civicfix123";
  const users: UserRow[] = [];
  const created = now - 120 * DAY;

  const addUser = (u: Omit<UserRow, "userId" | "password" | "isActive" | "phones" | "createdAt"> & { phones?: string[] }) => {
    const row: UserRow = {
      userId: users.length + 1,
      password: PASSWORD,
      isActive: true,
      phones: u.phones ?? [phoneFor(users.length + 1)],
      createdAt: created + users.length * H,
      ...u,
    };
    users.push(row);
    return row;
  };

  // Administrators
  const commissioner = addUser({ name: "S. Narayan", email: "commissioner@civicfix.test", role: "ADMIN", departmentId: null, wardId: null, supervisorId: null });
  const wardAdmins = [
    addUser({ name: "Meera Iyer", email: "meera.iyer@civicfix.test", role: "ADMIN", departmentId: null, wardId: 1, supervisorId: commissioner.userId }),
    addUser({ name: "Farhan Sheikh", email: "farhan.sheikh@civicfix.test", role: "ADMIN", departmentId: null, wardId: 2, supervisorId: commissioner.userId }),
    addUser({ name: "Lakshmi Hegde", email: "lakshmi.hegde@civicfix.test", role: "ADMIN", departmentId: null, wardId: 3, supervisorId: commissioner.userId }),
  ];

  // Department heads (escalation level 1)
  const heads = DEPARTMENTS.map((d, i) =>
    addUser({ name: HEAD_NAMES[i], email: emailFor(HEAD_NAMES[i]), role: "STAFF", departmentId: d.departmentId, wardId: 10, supervisorId: commissioner.userId }),
  );

  // Field staff: every department covers Koramangala plus two other wards
  const staff: UserRow[] = [];
  let s = 0;
  for (const d of DEPARTMENTS) {
    const wards = [1, ((d.departmentId * 2) % 9) + 2, ((d.departmentId * 3 + 1) % 9) + 2];
    for (const w of [...new Set(wards)]) {
      const name = STAFF_NAMES[s++ % STAFF_NAMES.length];
      staff.push(addUser({ name, email: emailFor(name), role: "STAFF", departmentId: d.departmentId, wardId: w, supervisorId: heads[d.departmentId - 1].userId }));
    }
  }

  const citizens = CITIZEN_NAMES.map((name, i) =>
    addUser({
      name,
      email: i === 0 ? "ananya@civicfix.test" : emailFor(name),
      role: "CITIZEN",
      departmentId: null,
      wardId: null,
      supervisorId: null,
      phones: i % 5 === 0 ? [phoneFor(100 + i), phoneFor(200 + i)] : [phoneFor(100 + i)],
    }),
  );
  const ananya = citizens[0];

  const pickAssignee = (departmentId: number, wardId: number) => {
    const local = staff.filter((u) => u.departmentId === departmentId && u.wardId === wardId);
    const pool = local.length ? local : staff.filter((u) => u.departmentId === departmentId);
    return pool[Math.floor(r() * pool.length)];
  };

  const complaints: ComplaintRow[] = [];
  const history: HistoryRow[] = [];
  const escalations: EscalationRow[] = [];
  const upvotes: UpvoteRow[] = [];
  const matches: MatchRow[] = [];
  const notifications: NotificationRow[] = [];

  const pushHistory = (c: ComplaintRow, newStatus: ComplaintStatus, by: number | null, at: number, remarks: string | null = null) => {
    const prev = history.filter((h) => h.complaintId === c.complaintId);
    history.push({
      complaintId: c.complaintId,
      historyNo: prev.length + 1,
      oldStatus: prev.length ? prev[prev.length - 1].newStatus : null,
      newStatus,
      changedBy: by,
      remarks,
      changedAt: at,
    });
    c.status = newStatus;
    c.updatedAt = at;
  };

  const notify = (userId: number, complaintId: number | null, type: NotificationType, message: string, at: number) => {
    notifications.push({ notificationId: notifications.length + 1, userId, complaintId, type, message, readStatus: now - at > 4 * DAY, sentAt: at });
  };

  const TOTAL = 164;
  for (let i = 0; i < TOTAL; i++) {
    const id = i + 1;
    // Skew towards recent days, oldest ~75 days ago
    const ageDays = Math.pow(r(), 1.25) * 75;
    const createdAt = now - ageDays * DAY - between(0, 12) * H;
    const wardId = i % 6 === 0 ? 1 : pick(WARDS).wardId;
    const category = i % 12 === 0 ? CATEGORIES[0] : pick(CATEGORIES);
    const tpl = TEMPLATES[category.categoryId];
    const place = pick(PLACES[wardId]);
    const ward = WARDS[wardId - 1];
    const filer = i % 9 === 0 ? ananya : pick(citizens);
    const c: ComplaintRow = {
      complaintId: id,
      title: pick(tpl.titles).replace("{p}", place),
      description: pick(tpl.descriptions).replace(/\{p\}/g, place),
      categoryId: category.categoryId,
      departmentId: category.departmentId,
      wardId,
      status: "OPEN",
      priority: r() < 0.08 ? "CRITICAL" : r() < 0.2 ? "HIGH" : r() < 0.1 ? "LOW" : "NORMAL",
      address: `${place}, ${ward.name}, Bengaluru`,
      latitude: +(ward.latitude + between(-0.009, 0.009)).toFixed(6),
      longitude: +(ward.longitude + between(-0.009, 0.009)).toFixed(6),
      createdAt,
      updatedAt: createdAt,
      slaDeadline: createdAt + category.slaHours * H,
      resolvedAt: null,
      filedBy: filer.userId,
      assignedTo: null,
      duplicateOf: null,
    };
    complaints.push(c);
    pushHistory(c, "OPEN", filer.userId, createdAt, "Complaint filed");

    // Auto-assignment trigger
    const assignee = pickAssignee(c.departmentId, c.wardId);
    const assignedAt = createdAt + between(2, 12) * 60_000;
    c.assignedTo = assignee.userId;
    pushHistory(c, "ASSIGNED", null, assignedAt, `Auto-assigned to ${assignee.name}`);
    notify(assignee.userId, id, "ASSIGNMENT", `New complaint assigned: ${c.title}`, assignedAt);

    const sla = category.slaHours * H;
    const age = now - createdAt;
    const roll = r();

    // Mostly-lifecycle simulation based on age
    if (age > sla * 1.3 || (age > sla * 0.4 && roll < 0.55)) {
      const startAt = assignedAt + between(0.05, 0.35) * sla;
      if (startAt < now) {
        pushHistory(c, "IN_PROGRESS", assignee.userId, startAt, pick(["Site inspected, crew scheduled", "Team dispatched", "Work order raised"]));
        const onTime = r() < 0.76;
        const resolveAt = onTime ? startAt + between(0.1, 0.5) * sla : c.slaDeadline + between(0.1, 1.2) * sla;
        const stillOpen = roll > 0.9 && age > sla;
        if (resolveAt < now - H && !stillOpen) {
          c.resolvedAt = resolveAt;
          pushHistory(c, "RESOLVED", assignee.userId, resolveAt, pick(["Repaired and cleared", "Work completed, photos attached", "Issue fixed by field team"]));
          notify(c.filedBy, id, "STATUS_UPDATE", `Your complaint ${c.title} was marked resolved`, resolveAt);
          if (now - resolveAt > 3 * DAY && r() < 0.8) {
            pushHistory(c, "CLOSED", r() < 0.6 ? c.filedBy : null, resolveAt + between(1, 3) * DAY, r() < 0.6 ? "Confirmed fixed by citizen" : "Auto-closed after 7 days");
          } else if (r() < 0.12) {
            pushHistory(c, "REOPENED", c.filedBy, resolveAt + between(2, 20) * H, "The problem is back after the first rain");
            c.resolvedAt = null;
          }
        }
      }
    }
  }

  // Paraphrased re-reports of open complaints: half already merged, half waiting in the review queue.
  const originals = complaints.filter((o) => ["ASSIGNED", "IN_PROGRESS"].includes(o.status) && now - o.createdAt < 30 * DAY && now - o.createdAt > 6 * H).slice(0, 12);
  originals.forEach((o, k) => {
    const tpl = TEMPLATES[o.categoryId];
    const place = o.address?.split(",")[0] ?? pick(PLACES[o.wardId]);
    const title = (tpl.titles.find((t) => t.replace("{p}", place) !== o.title) ?? tpl.titles[0]).replace("{p}", place);
    const description = (tpl.descriptions.find((t) => t.replace(/\{p\}/g, place) !== o.description) ?? tpl.descriptions[0]).replace(/\{p\}/g, place);
    const createdAt = Math.min(o.createdAt + between(1, 20) * H, now - 2 * H);
    const filer = citizens.filter((u) => u.userId !== o.filedBy)[(k * 5) % (citizens.length - 1)];
    const cat = CATEGORIES[o.categoryId - 1];
    const c: ComplaintRow = {
      ...o,
      complaintId: complaints.length + 1,
      title,
      description,
      status: "OPEN",
      priority: "NORMAL",
      createdAt,
      updatedAt: createdAt,
      slaDeadline: createdAt + cat.slaHours * H,
      resolvedAt: null,
      filedBy: filer.userId,
      duplicateOf: null,
      latitude: o.latitude === null ? null : +(o.latitude + 0.0004).toFixed(6),
      longitude: o.longitude === null ? null : +(o.longitude - 0.0003).toFixed(6),
    };
    complaints.push(c);
    pushHistory(c, "OPEN", filer.userId, createdAt, "Complaint filed");
    pushHistory(c, "ASSIGNED", null, createdAt + 4 * 60_000, `Auto-assigned to ${users[o.assignedTo! - 1].name}`);
    const score = +between(0.78, 0.94).toFixed(4);
    const reviewAt = createdAt + between(1, 4) * H;
    if (k % 2 === 0 && reviewAt < now) {
      matches.push({ complaintId: c.complaintId, matchedComplaintId: o.complaintId, score, reviewStatus: "CONFIRMED", reviewedBy: o.assignedTo, detectedAt: createdAt + 60_000, reviewedAt: reviewAt });
      c.duplicateOf = o.complaintId;
      pushHistory(c, "DUPLICATE", o.assignedTo, reviewAt, `Merged into ${o.complaintId}`);
    } else {
      matches.push({ complaintId: c.complaintId, matchedComplaintId: o.complaintId, score, reviewStatus: "PENDING", reviewedBy: null, detectedAt: createdAt + 60_000, reviewedAt: null });
      notify(o.assignedTo!, c.complaintId, "DUPLICATE_FLAG", `Possible duplicate of ${o.title}`, createdAt + 90_000);
    }
  });

  // Escalate roughly half of the overdue open complaints; leave the rest for "Run SLA sweep now".
  const openStates: ComplaintStatus[] = ["ASSIGNED", "IN_PROGRESS", "REOPENED"];
  const overdue = complaints.filter((c) => openStates.includes(c.status) && c.slaDeadline < now);
  overdue.forEach((c, idx) => {
    if (idx % 2 === 1) return;
    const head = heads[c.departmentId - 1];
    const wardAdmin = wardAdmins.find((a) => a.wardId === c.wardId) ?? commissioner;
    const levels = [
      { level: 1, to: head, after: 0 },
      { level: 2, to: wardAdmin, after: 24 * H },
      { level: 3, to: commissioner, after: 48 * H },
    ];
    for (const l of levels) {
      const at = c.slaDeadline + l.after + 5 * 60_000;
      if (at > now) break;
      escalations.push({
        complaintId: c.complaintId,
        level: l.level,
        escalatedFrom: l.level === 1 ? c.assignedTo : levels[l.level - 2].to.userId,
        escalatedTo: l.to.userId,
        reason: `SLA breached by ${Math.max(1, Math.round((at - c.slaDeadline) / H))} h`,
        escalatedAt: at,
        resolvedAt: null,
      });
      if (l.level === 1) pushHistory(c, "ESCALATED", null, at, `Escalated to ${l.to.name} (level 1)`);
      notify(l.to.userId, c.complaintId, "ESCALATION", `Level ${l.level} escalation: ${c.title}`, at);
      notify(c.filedBy, c.complaintId, "ESCALATION", `Your complaint was escalated to level ${l.level}`, at);
    }
  });

  // Confirmed duplicates: later report in same ward and category as an earlier open one
  let dupCount = 0;
  for (const c of complaints) {
    if (dupCount >= 9) break;
    if (!["ASSIGNED", "OPEN"].includes(c.status) || matches.some((m) => m.complaintId === c.complaintId || m.matchedComplaintId === c.complaintId)) continue;
    const original = complaints.find(
      (o) => o.complaintId < c.complaintId && o.wardId === c.wardId && o.categoryId === c.categoryId && o.status !== "DUPLICATE" && c.createdAt - o.createdAt < 20 * DAY,
    );
    if (!original) continue;
    const reviewer = staff.find((u) => u.userId === c.assignedTo) ?? heads[0];
    const at = c.createdAt + between(1, 6) * H;
    if (at > now) continue;
    matches.push({ complaintId: c.complaintId, matchedComplaintId: original.complaintId, score: +between(0.82, 0.95).toFixed(4), reviewStatus: "CONFIRMED", reviewedBy: reviewer.userId, detectedAt: c.createdAt + 60_000, reviewedAt: at });
    c.duplicateOf = original.complaintId;
    pushHistory(c, "DUPLICATE", reviewer.userId, at, `Merged into ${original.complaintId}`);
    dupCount++;
  }

  // Pending duplicate matches for the review queue (recent, still open)
  const recentOpen = complaints.filter((c) => ["ASSIGNED", "IN_PROGRESS"].includes(c.status) && now - c.createdAt < 25 * DAY);
  let pending = 0;
  for (const c of recentOpen) {
    if (pending >= 7) break;
    if (matches.some((m) => m.complaintId === c.complaintId)) continue;
    const other = recentOpen.find((o) => o.complaintId < c.complaintId && o.wardId === c.wardId && o.departmentId === c.departmentId);
    if (!other) continue;
    matches.push({
      complaintId: c.complaintId,
      matchedComplaintId: other.complaintId,
      score: +(other.categoryId === c.categoryId ? between(0.72, 0.91) : between(0.56, 0.68)).toFixed(4),
      reviewStatus: "PENDING",
      reviewedBy: null,
      detectedAt: c.createdAt + 60_000,
      reviewedAt: null,
    });
    const assignee = users.find((u) => u.userId === c.assignedTo);
    if (assignee) notify(assignee.userId, c.complaintId, "DUPLICATE_FLAG", `Possible duplicate of ${other.title}`, c.createdAt + 90_000);
    pending++;
  }

  // Upvotes from other citizens
  for (const c of complaints) {
    if (c.status === "DUPLICATE") continue;
    const n = Math.floor(Math.pow(r(), 2.2) * 22);
    const voters = new Set<number>();
    for (let k = 0; k < n; k++) {
      const v = pick(citizens);
      if (v.userId !== c.filedBy) voters.add(v.userId);
    }
    for (const v of voters) upvotes.push({ complaintId: c.complaintId, userId: v, upvotedAt: c.createdAt + between(0.1, 1) * Math.min(now - c.createdAt, 10 * DAY) });
  }

  notifications.sort((a, b) => a.sentAt - b.sentAt).forEach((n, i) => (n.notificationId = i + 1));

  return {
    now,
    wards: WARDS,
    departments: DEPARTMENTS,
    categories: CATEGORIES,
    users,
    complaints,
    history,
    escalations,
    upvotes,
    matches,
    notifications,
    sessions: new Map(),
    vectorPayloadPatches: new Map(),
    deletedVectorIds: new Set(),
  };
}
