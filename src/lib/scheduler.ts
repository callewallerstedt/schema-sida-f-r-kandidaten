export const BOOKINGS_STORAGE_KEY = "computer-scheduler:v1:bookings";
export const VIEW_STORAGE_KEY = "computer-scheduler:v1:view";
export const TIME_SESSIONS_STORAGE_KEY = "computer-scheduler:v1:time-sessions";
export const DAY_MINUTES = 24 * 60;
export const MIN_BOOKING_MINUTES = 15;
export const DRAG_SNAP_MINUTES = 5;
export const SCHEDULE_START_MINUTES = 8 * 60;
export const SCHEDULE_END_MINUTES = 17 * 60;

export type Computer = {
  id: string;
  name: string;
};

export type Group = {
  id: string;
  name: string;
  color: string;
  accentColor: string;
  surfaceColor: string;
};

export type Booking = {
  id: string;
  computerId: string;
  bookingSeriesId: string | null;
  groupId: string;
  title: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  repeatWeekly: boolean;
  isFullRoom: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BookingDraft = Omit<
  Booking,
  "id" | "createdAt" | "updatedAt"
>;

export type BookingOverlapShape = Pick<
  Booking,
  "id" | "computerId" | "date" | "startMinutes" | "endMinutes" | "repeatWeekly"
>;

export type WeekSummary = {
  totalMinutes: number;
  byGroup: Record<string, number>;
  byComputer: Record<string, number>;
};

export type TimeSession = {
  id: string;
  userId: string;
  computerId: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export const computers: Computer[] = [
  { id: "old-linux", name: "Shitty Linux" },
  { id: "windows-1", name: "Windows 1" },
  { id: "windows-2", name: "Windows 2" },
  { id: "new-linux", name: "Good Linux" },
];

export const groups: Group[] = [
  {
    id: "rita-cellen",
    name: "Rita cellen",
    color: "#eb5e28",
    accentColor: "#ffe4b5",
    surfaceColor: "rgba(235, 94, 40, 0.18)",
  },
  {
    id: "fabriken",
    name: "Fabriken",
    color: "#1b998b",
    accentColor: "#cff7f0",
    surfaceColor: "rgba(27, 153, 139, 0.18)",
  },
];

export function startOfWeek(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return copy;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function getWeekDays(weekStartKey: string) {
  const weekStart = parseDateKey(weekStartKey);
  return Array.from({ length: 7 }, (_, index) =>
    formatDateKey(addDays(weekStart, index)),
  );
}

export function formatDayLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parseDateKey(dateKey));
}

export function formatWeekRange(weekStartKey: string) {
  const start = parseDateKey(weekStartKey);
  const end = addDays(start, 6);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  });
  const yearFormatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
  });
  return `${formatter.format(start)} - ${formatter.format(end)} ${yearFormatter.format(end)}`;
}

export function minutesToTime(minutes: number) {
  if (minutes >= DAY_MINUTES) {
    return "24:00";
  }
  const clamped = clampMinutes(minutes);
  const hours = Math.floor(clamped / 60);
  const remainingMinutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }
  return clampMinutes(hours * 60 + minutes);
}

export function clampMinutes(minutes: number) {
  return Math.min(DAY_MINUTES, Math.max(0, Math.round(minutes)));
}

export function snapMinutes(minutes: number) {
  return clampMinutes(
    Math.round(minutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES,
  );
}

export function getMinutesFromPosition(offset: number, laneHeight: number) {
  const ratio = laneHeight <= 0 ? 0 : offset / laneHeight;
  return snapMinutes(ratio * DAY_MINUTES);
}

export function formatHours(minutes: number) {
  const hours = minutes / 60;
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

export function formatHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
}

export function bookingDuration(booking: Pick<Booking, "startMinutes" | "endMinutes">) {
  return Math.max(0, booking.endMinutes - booking.startMinutes);
}

function getWeekday(dateKey: string) {
  return parseDateKey(dateKey).getDay();
}

function canDatesCollide(
  existing: Pick<BookingOverlapShape, "date" | "repeatWeekly">,
  candidate: Pick<BookingOverlapShape, "date" | "repeatWeekly">,
) {
  if (existing.repeatWeekly && candidate.repeatWeekly) {
    return getWeekday(existing.date) === getWeekday(candidate.date);
  }

  if (existing.repeatWeekly) {
    return (
      candidate.date >= existing.date &&
      getWeekday(existing.date) === getWeekday(candidate.date)
    );
  }

  if (candidate.repeatWeekly) {
    return (
      existing.date >= candidate.date &&
      getWeekday(existing.date) === getWeekday(candidate.date)
    );
  }

  return existing.date === candidate.date;
}

export function hasOverlap(
  bookings: BookingOverlapShape[],
  candidate: Omit<BookingOverlapShape, "id">,
  ignoreId?: string | string[],
) {
  const ignoredIds = Array.isArray(ignoreId)
    ? new Set(ignoreId)
    : ignoreId
      ? new Set([ignoreId])
      : null;

  return bookings.some((booking) => {
    if (ignoredIds?.has(booking.id)) {
      return false;
    }
    if (
      booking.computerId !== candidate.computerId ||
      !canDatesCollide(booking, candidate)
    ) {
      return false;
    }
    return (
      candidate.startMinutes < booking.endMinutes &&
      candidate.endMinutes > booking.startMinutes
    );
  });
}

export function computeWeekSummary(bookings: Booking[]): WeekSummary {
  const summary: WeekSummary = {
    totalMinutes: 0,
    byGroup: Object.fromEntries(groups.map((group) => [group.id, 0])),
    byComputer: Object.fromEntries(computers.map((computer) => [computer.id, 0])),
  };

  for (const booking of bookings) {
    const duration = bookingDuration(booking);
    summary.totalMinutes += duration;
    summary.byGroup[booking.groupId] =
      (summary.byGroup[booking.groupId] ?? 0) + duration;
    summary.byComputer[booking.computerId] =
      (summary.byComputer[booking.computerId] ?? 0) + duration;
  }

  return summary;
}

export function getGroup(groupId: string) {
  return groups.find((group) => group.id === groupId) ?? groups[0];
}

export function isBooking(value: unknown): value is Booking {
  if (!value || typeof value !== "object") {
    return false;
  }
  const booking = value as Record<string, unknown>;
  return (
    typeof booking.id === "string" &&
    typeof booking.computerId === "string" &&
    (typeof booking.bookingSeriesId === "string" ||
      booking.bookingSeriesId === null ||
      typeof booking.bookingSeriesId === "undefined") &&
    typeof booking.groupId === "string" &&
    typeof booking.title === "string" &&
    typeof booking.date === "string" &&
    typeof booking.startMinutes === "number" &&
    typeof booking.endMinutes === "number" &&
    (typeof booking.repeatWeekly === "boolean" ||
      typeof booking.repeatWeekly === "undefined") &&
    (typeof booking.isFullRoom === "boolean" ||
      typeof booking.isFullRoom === "undefined") &&
    typeof booking.createdAt === "string" &&
    typeof booking.updatedAt === "string"
  );
}

export function isTimeSession(value: unknown): value is TimeSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    typeof session.userId === "string" &&
    (typeof session.computerId === "string" || session.computerId === null) &&
    typeof session.checkInAt === "string" &&
    (typeof session.checkOutAt === "string" || session.checkOutAt === null) &&
    typeof session.note === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string"
  );
}

export function sessionDurationMinutes(
  session: Pick<TimeSession, "checkInAt" | "checkOutAt">,
  now = Date.now(),
) {
  const start = new Date(session.checkInAt).getTime();
  const end = session.checkOutAt ? new Date(session.checkOutAt).getTime() : now;
  return Math.max(0, Math.round((end - start) / 60000));
}
