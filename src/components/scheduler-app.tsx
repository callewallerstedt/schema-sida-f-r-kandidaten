"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DAY_MINUTES,
  MIN_BOOKING_MINUTES,
  SCHEDULE_END_MINUTES,
  SCHEDULE_START_MINUTES,
  VIEW_STORAGE_KEY,
  addDays,
  bookingDuration,
  clampMinutes,
  computeWeekSummary,
  computePresenceMinutes,
  computers,
  formatDateKey,
  formatDayLabel,
  formatHours,
  formatHoursAndMinutes,
  formatWeekRange,
  getGroup,
  getMinutesFromPosition,
  getWeekDays,
  groups,
  hasOverlap,
  minutesToTime,
  parseDateKey,
  sessionDurationMinutes,
  startOfWeek,
  type Booking,
  type BookingDraft,
  type TimeSession,
  type WeekSummary,
} from "@/lib/scheduler";

const LANE_HEIGHT = 360;
const DEFAULT_GROUP_ID = groups[0]?.id ?? "";
const VISIBLE_HOUR_MARKERS = [8, 12];
const TIME_OPTIONS = Array.from(
  { length: (SCHEDULE_END_MINUTES - SCHEDULE_START_MINUTES) / 5 + 1 },
  (_, index) => SCHEDULE_START_MINUTES + index * 5,
);

type EditorState = {
  mode: "create" | "edit";
  draft: BookingDraft;
  bookingId?: string;
  bookingIds?: string[];
  selectedComputerIds?: string[];
  fullRoom?: boolean;
};

type CreateDragState = {
  kind: "create";
  date: string;
  laneTop: number;
  laneHeight: number;
  anchorMinutes: number;
  currentMinutes: number;
};

type ResizeDragState = {
  kind: "resize";
  bookingId: string;
  bookingIds: string[];
  computerId: string;
  date: string;
  bookingSeriesId: string | null;
  isFullRoom: boolean;
  edge: "start" | "end";
  laneTop: number;
  laneHeight: number;
  currentStart: number;
  currentEnd: number;
};

type DragState = CreateDragState | ResizeDragState;

type ViewStorage = {
  weekStart?: string;
  lastGroupId?: string;
  filteredComputerIds?: string[];
};

type FullRoomDisplayBooking = {
  key: string;
  booking: Booking;
  bookingIds: string[];
  computerIds: string[];
  startColumn: number;
  endColumn: number;
};

function normalizeBooking(booking: Booking) {
  return {
    ...booking,
    bookingSeriesId: booking.bookingSeriesId ?? null,
    isFullRoom: booking.isFullRoom ?? false,
  };
}

function loadInitialState() {
  const fallbackWeekStart = getInitialWeekStart();

  if (typeof window === "undefined") {
    return {
      bookings: [] as Booking[],
      weekStart: fallbackWeekStart,
      activeGroupId: DEFAULT_GROUP_ID,
      filteredComputerIds: computers.map((computer) => computer.id),
    };
  }

  try {
    const storedView = localStorage.getItem(VIEW_STORAGE_KEY);
    const parsedView = storedView ? (JSON.parse(storedView) as ViewStorage) : {};

    return {
      bookings: [] as Booking[],
      weekStart: parsedView.weekStart ?? fallbackWeekStart,
      activeGroupId:
        parsedView.lastGroupId &&
        groups.some((group) => group.id === parsedView.lastGroupId)
          ? parsedView.lastGroupId
          : DEFAULT_GROUP_ID,
      filteredComputerIds:
        parsedView.filteredComputerIds &&
        Array.isArray(parsedView.filteredComputerIds) &&
        parsedView.filteredComputerIds.length > 0
          ? parsedView.filteredComputerIds.filter((computerId) =>
              computers.some((computer) => computer.id === computerId),
            )
          : computers.map((computer) => computer.id),
    };
  } catch {
    return {
      bookings: [] as Booking[],
      weekStart: fallbackWeekStart,
      activeGroupId: DEFAULT_GROUP_ID,
      filteredComputerIds: computers.map((computer) => computer.id),
    };
  }
}

function getWeekSummaryCard(
  summary: WeekSummary,
  computerId: string,
  groupId: string,
) {
  return {
    computerMinutes: summary.byComputer[computerId] ?? 0,
    groupMinutes: summary.byGroup[groupId] ?? 0,
  };
}

function getComputerLabel(name: string) {
  if (name === "Shitty Linux") {
    return "SL";
  }
  if (name === "Good Linux") {
    return "GL";
  }
  if (name === "Windows 1") {
    return "W1";
  }
  if (name === "Windows 2") {
    return "W2";
  }
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getComputerSurface(computerId: string) {
  switch (computerId) {
    case "old-linux":
      return {
        border: "rgba(239, 68, 68, 0.3)",
        background: "linear-gradient(180deg, rgba(254, 226, 226, 0.9), rgba(255,255,255,0.88))",
      };
    case "windows-1":
      return {
        border: "rgba(59, 130, 246, 0.32)",
        background: "linear-gradient(180deg, rgba(219, 234, 254, 0.92), rgba(255,255,255,0.88))",
      };
    case "windows-2":
      return {
        border: "rgba(14, 165, 233, 0.32)",
        background: "linear-gradient(180deg, rgba(224, 242, 254, 0.92), rgba(255,255,255,0.88))",
      };
    case "new-linux":
      return {
        border: "rgba(34, 197, 94, 0.3)",
        background: "linear-gradient(180deg, rgba(220, 252, 231, 0.92), rgba(255,255,255,0.88))",
      };
    default:
      return {
        border: "rgba(148, 163, 184, 0.3)",
        background: "linear-gradient(180deg, rgba(248,250,252,0.92), rgba(255,255,255,0.88))",
      };
  }
}

function getBlockStyle(startMinutes: number, endMinutes: number): CSSProperties {
  const range = SCHEDULE_END_MINUTES - SCHEDULE_START_MINUTES;
  const top = ((startMinutes - SCHEDULE_START_MINUTES) / range) * 100;
  const height = ((endMinutes - startMinutes) / range) * 100;
  return {
    top: `${top}%`,
    height: `${height}%`,
  };
}

function getScheduleMinutesFromPosition(offset: number, laneHeight: number) {
  const minutes = getMinutesFromPosition(offset, laneHeight);
  const range = SCHEDULE_END_MINUTES - SCHEDULE_START_MINUTES;
  const mapped =
    SCHEDULE_START_MINUTES +
    (Math.min(DAY_MINUTES, Math.max(0, minutes)) / DAY_MINUTES) * range;

  return clampMinutes(mapped);
}

function ensureValidTimeRange(
  draft: BookingDraft,
  field: "startMinutes" | "endMinutes",
  minutes: number,
) {
  if (field === "startMinutes") {
    const nextStart = Math.max(
      SCHEDULE_START_MINUTES,
      Math.min(minutes, SCHEDULE_END_MINUTES - MIN_BOOKING_MINUTES),
    );
    const nextEnd = Math.max(
      draft.endMinutes,
      Math.min(SCHEDULE_END_MINUTES, nextStart + MIN_BOOKING_MINUTES),
    );
    return {
      ...draft,
      startMinutes: nextStart,
      endMinutes: nextEnd,
    };
  }

  const nextEnd = Math.min(
    SCHEDULE_END_MINUTES,
    Math.max(minutes, SCHEDULE_START_MINUTES + MIN_BOOKING_MINUTES),
  );
  const nextStart = Math.min(
    draft.startMinutes,
    Math.max(SCHEDULE_START_MINUTES, nextEnd - MIN_BOOKING_MINUTES),
  );

  return {
    ...draft,
    startMinutes: nextStart,
    endMinutes: nextEnd,
  };
}

function occursThisWeek(booking: Booking, weekDays: string[]) {
  if (!booking.repeatWeekly) {
    return weekDays.includes(booking.date);
  }

  return weekDays.some(
    (day) =>
      day >= booking.date &&
      parseDateKey(day).getDay() === parseDateKey(booking.date).getDay(),
  );
}

function materializeBookingForWeek(booking: Booking, weekDays: string[]) {
  if (!booking.repeatWeekly) {
    return weekDays.includes(booking.date) ? booking : null;
  }

  const matchingDay = weekDays.find(
    (day) =>
      day >= booking.date &&
      parseDateKey(day).getDay() === parseDateKey(booking.date).getDay(),
  );

  return matchingDay ? { ...booking, date: matchingDay } : null;
}

function getInitialWeekStart() {
  return formatDateKey(startOfWeek(new Date()));
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & { error?: string }) | null = null;

  if (raw) {
    try {
      body = JSON.parse(raw) as T & { error?: string };
    } catch {
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}).`);
      }
      throw new Error("Server returned an invalid response.");
    }
  }

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }

  if (!body) {
    throw new Error("Server returned an empty response.");
  }

  return body;
}

export function SchedulerApp() {
  const [initialState] = useState(loadInitialState);
  const [bookings, setBookings] = useState<Booking[]>(initialState.bookings);
  const [timeSessions, setTimeSessions] = useState<TimeSession[]>([]);
  const [weekStart, setWeekStart] = useState(initialState.weekStart);
  const [activeGroupId, setActiveGroupId] = useState(
    initialState.activeGroupId,
  );
  const [filteredComputerIds, setFilteredComputerIds] = useState(
    initialState.filteredComputerIds,
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingUserId, setTrackingUserId] = useState("");
  const [checkoutNote, setCheckoutNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [isDataLoading, setIsDataLoading] = useState(true);

  const dragStateRef = useRef<DragState | null>(null);
  const bookingsRef = useRef<Booking[]>([]);
  const activeGroupRef = useRef(DEFAULT_GROUP_ID);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    bookingsRef.current = bookings;
  }, [bookings]);

  useEffect(() => {
    activeGroupRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleComputers = useMemo(() => {
    const next = computers.filter((computer) =>
      filteredComputerIds.includes(computer.id),
    );

    return next.length > 0 ? next : computers;
  }, [filteredComputerIds]);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const [bookingsResponse, sessionsResponse] = await Promise.all([
          fetch("/api/bookings", { cache: "no-store" }),
          fetch("/api/time-sessions", { cache: "no-store" }),
        ]);

        const bookingsBody = await parseJsonResponse<{ bookings: Booking[] }>(
          bookingsResponse,
        );
        const sessionsBody = await parseJsonResponse<{
          sessions: TimeSession[];
        }>(sessionsResponse);

        if (!cancelled) {
          setBookings(bookingsBody.bookings.map(normalizeBooking));
          setTimeSessions(sessionsBody.sessions);
        }
      } catch (error) {
        if (!cancelled) {
          setToast(
            error instanceof Error
              ? error.message
              : "Failed to load shared schedule data.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsDataLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!weekStart) {
      return;
    }

    localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({
        weekStart,
        lastGroupId: activeGroupId,
        filteredComputerIds,
      } satisfies ViewStorage),
    );
  }, [activeGroupId, filteredComputerIds, weekStart]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragStateRef.current;

      if (!current) {
        return;
      }

      const nextMinutes = getScheduleMinutesFromPosition(
        event.clientY - current.laneTop,
        current.laneHeight,
      );

      if (current.kind === "create") {
        setDragState({
          ...current,
          currentMinutes: nextMinutes,
        });
        return;
      }

      if (current.edge === "start") {
        setDragState({
          ...current,
          currentStart: clampMinutes(
            Math.min(nextMinutes, current.currentEnd - MIN_BOOKING_MINUTES),
          ),
        });
        return;
      }

      setDragState({
        ...current,
        currentEnd: clampMinutes(
          Math.max(nextMinutes, current.currentStart + MIN_BOOKING_MINUTES),
        ),
      });
    };

    const handlePointerUp = () => {
      const current = dragStateRef.current;

      if (!current) {
        return;
      }

      if (current.kind === "create") {
        const startMinutes = Math.min(
          current.anchorMinutes,
          current.currentMinutes,
        );
        const endMinutes = Math.max(current.anchorMinutes, current.currentMinutes);

        if (endMinutes - startMinutes < MIN_BOOKING_MINUTES) {
          setToast("Booking blocks need at least 15 minutes.");
          setDragState(null);
          return;
        }

        setEditorState({
          mode: "create",
          draft: {
            computerId: visibleComputers[0]?.id ?? computers[0]?.id ?? "",
            bookingSeriesId: null,
            groupId: activeGroupRef.current,
            title: "",
            date: current.date,
            startMinutes,
            endMinutes,
            repeatWeekly: false,
            isFullRoom: false,
          },
          selectedComputerIds:
            visibleComputers.length === 1 ? [visibleComputers[0].id] : [],
          fullRoom: false,
        });
        setDragState(null);
        return;
      }

      const booking = bookingsRef.current.find(
        (entry) => entry.id === current.bookingId,
      );

      if (!booking) {
        setDragState(null);
        return;
      }

      const nextBooking: Booking = {
        ...booking,
        startMinutes: current.currentStart,
        endMinutes: current.currentEnd,
        updatedAt: new Date().toISOString(),
      };

      if (
        nextBooking.endMinutes - nextBooking.startMinutes <
        MIN_BOOKING_MINUTES
      ) {
        setToast("Booking blocks need at least 15 minutes.");
        setDragState(null);
        return;
      }

      const relatedBookings = bookingsRef.current.filter((entry) =>
        current.bookingIds.includes(entry.id),
      );
      const conflictIds = current.bookingIds.length > 0
        ? current.bookingIds
        : current.bookingId;
      const overlaps = (relatedBookings.length > 0 ? relatedBookings : [booking]).some(
        (entry) =>
          hasOverlap(
            bookingsRef.current,
            {
              computerId: entry.computerId,
              date: nextBooking.date,
              startMinutes: nextBooking.startMinutes,
              endMinutes: nextBooking.endMinutes,
              repeatWeekly: nextBooking.repeatWeekly,
            },
            conflictIds,
          ),
      );

      if (overlaps) {
        setToast("That resize would overlap another booking.");
        setDragState(null);
        return;
      }

      void (async () => {
        try {
          const response = await fetch("/api/bookings", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ids: current.bookingIds,
              booking: {
                computerId: nextBooking.computerId,
                bookingSeriesId: nextBooking.bookingSeriesId,
                groupId: nextBooking.groupId,
                title: nextBooking.title,
                date: nextBooking.date,
                startMinutes: nextBooking.startMinutes,
                endMinutes: nextBooking.endMinutes,
                repeatWeekly: nextBooking.repeatWeekly,
                isFullRoom: current.isFullRoom,
              },
            }),
          });
          const body = await parseJsonResponse<{ bookings: Booking[] }>(response);
          const updatedById = new Map(
            body.bookings.map(normalizeBooking).map((entry) => [entry.id, entry]),
          );
          setBookings((currentBookings) =>
            currentBookings.map((entry) =>
              updatedById.get(entry.id) ?? entry,
            ),
          );
        } catch (error) {
          setToast(
            error instanceof Error
              ? error.message
              : "Failed to update booking.",
          );
        }
      })();
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState, visibleComputers]);

  const weekDays = useMemo(
    () => (weekStart ? getWeekDays(weekStart) : []),
    [weekStart],
  );

  const weekBookings = useMemo(() => {
    if (!weekStart || weekDays.length === 0) {
      return [];
    }

    return bookings
      .filter((booking) => occursThisWeek(booking, weekDays))
      .map((booking) => materializeBookingForWeek(booking, weekDays))
      .filter((booking): booking is Booking => booking !== null)
      .map(normalizeBooking)
      .sort((left, right) => {
        if (left.date === right.date) {
          return left.startMinutes - right.startMinutes;
        }
        return left.date.localeCompare(right.date);
      });
  }, [bookings, weekDays, weekStart]);

  const weekSummary = useMemo(
    () => computeWeekSummary(weekBookings),
    [weekBookings],
  );

  const presenceMinutesByDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const day of weekDays) {
      map.set(
        day,
        computePresenceMinutes(
          weekBookings.filter((booking) => booking.date === day),
        ).totalMinutes,
      );
    }

    return map;
  }, [weekBookings, weekDays]);

  const bookingsByLane = useMemo(() => {
    const map = new Map<string, Booking[]>();

    for (const booking of weekBookings) {
      if (booking.isFullRoom && booking.bookingSeriesId) {
        continue;
      }
      const key = `${booking.computerId}:${booking.date}`;
      const laneBookings = map.get(key) ?? [];
      laneBookings.push(booking);
      map.set(key, laneBookings);
    }

    for (const laneBookings of map.values()) {
      laneBookings.sort((left, right) => left.startMinutes - right.startMinutes);
    }

    return map;
  }, [weekBookings]);

  const bookingMinutesByLane = useMemo(() => {
    const map = new Map<string, number>();

    for (const booking of weekBookings) {
      const key = `${booking.computerId}:${booking.date}`;
      map.set(key, (map.get(key) ?? 0) + bookingDuration(booking));
    }

    return map;
  }, [weekBookings]);

  const fullRoomBookingsByDay = useMemo(() => {
    const visibleIndexes = new Map(
      visibleComputers.map((computer, index) => [computer.id, index]),
    );
    const grouped = new Map<
      string,
      {
        booking: Booking;
        bookingIds: string[];
        computerIds: string[];
      }
    >();

    for (const booking of weekBookings) {
      if (!booking.isFullRoom || !booking.bookingSeriesId) {
        continue;
      }

      const key = `${booking.bookingSeriesId}:${booking.date}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          booking,
          bookingIds: [booking.id],
          computerIds: [booking.computerId],
        });
        continue;
      }

      current.bookingIds.push(booking.id);
      current.computerIds.push(booking.computerId);
    }

    const byDay = new Map<string, FullRoomDisplayBooking[]>();

    for (const [key, value] of grouped.entries()) {
      const visibleIds = value.computerIds
        .map((computerId) => visibleIndexes.get(computerId))
        .filter((index): index is number => index !== undefined)
        .sort((left, right) => left - right);

      if (visibleIds.length === 0) {
        continue;
      }

      const dayBookings = byDay.get(value.booking.date) ?? [];
      dayBookings.push({
        key,
        booking: value.booking,
        bookingIds: value.bookingIds,
        computerIds: value.computerIds,
        startColumn: visibleIds[0],
        endColumn: visibleIds[visibleIds.length - 1],
      });
      byDay.set(value.booking.date, dayBookings);
    }

    for (const bookingsForDay of byDay.values()) {
      bookingsForDay.sort(
        (left, right) => left.booking.startMinutes - right.booking.startMinutes,
      );
    }

    return byDay;
  }, [visibleComputers, weekBookings]);

  const normalizedTrackingUserId = trackingUserId.trim();

  const activeSessionForUser = useMemo(() => {
    if (!normalizedTrackingUserId) {
      return null;
    }

    return (
      timeSessions.find(
        (session) =>
          session.userId.toLowerCase() === normalizedTrackingUserId.toLowerCase() &&
          session.checkOutAt === null,
      ) ?? null
    );
  }, [normalizedTrackingUserId, timeSessions]);

  const timeTotalsByUser = useMemo(() => {
    const totals = new Map<
      string,
      {
        userId: string;
        totalMinutes: number;
        active: boolean;
        sessionCount: number;
      }
    >();

    for (const session of timeSessions) {
      const existing = totals.get(session.userId) ?? {
        userId: session.userId,
        totalMinutes: 0,
        active: false,
        sessionCount: 0,
      };

      existing.totalMinutes += sessionDurationMinutes(session, now);
      existing.active = existing.active || session.checkOutAt === null;
      existing.sessionCount += 1;
      totals.set(session.userId, existing);
    }

    return [...totals.values()].sort(
      (left, right) => right.totalMinutes - left.totalMinutes,
    );
  }, [now, timeSessions]);

  const activeSessions = useMemo(
    () => timeSessions.filter((session) => session.checkOutAt === null),
    [timeSessions],
  );

  const recentSessions = useMemo(
    () =>
      [...timeSessions]
        .sort(
          (left, right) =>
            new Date(right.checkInAt).getTime() - new Date(left.checkInAt).getTime(),
        )
        .slice(0, 8),
    [timeSessions],
  );

  const editorError = useMemo(() => {
    if (!editorState) {
      return null;
    }

    const title = editorState.draft.title.trim();
    if (!title) {
      return "Add a booking name.";
    }

    if (
      editorState.draft.endMinutes - editorState.draft.startMinutes <
      MIN_BOOKING_MINUTES
    ) {
      return "Bookings must be at least 15 minutes long.";
    }

    if (
      editorState.draft.startMinutes < SCHEDULE_START_MINUTES ||
      editorState.draft.endMinutes > SCHEDULE_END_MINUTES
    ) {
      return "Bookings can only be scheduled between 08:00 and 17:00.";
    }

    if (editorState.mode === "create") {
      const targetComputerIds = editorState.fullRoom
        ? computers.map((computer) => computer.id)
        : Array.from(new Set(editorState.selectedComputerIds ?? []));

      if (targetComputerIds.length === 0) {
        return "Select at least one computer.";
      }

      const conflictingComputer = computers.find((computer) =>
        targetComputerIds.includes(computer.id) &&
        hasOverlap(bookings, {
          ...editorState.draft,
          computerId: computer.id,
        }),
      );

      if (conflictingComputer) {
        return `Booking conflicts on ${conflictingComputer.name}.`;
      }

      return null;
    }

    const targetComputerIds =
      editorState.fullRoom && (editorState.selectedComputerIds?.length ?? 0) > 0
        ? editorState.selectedComputerIds ?? []
        : [editorState.draft.computerId];
    const ignoreIds =
      editorState.bookingIds && editorState.bookingIds.length > 0
        ? editorState.bookingIds
        : editorState.bookingId;

    const conflictingComputer = computers.find((computer) =>
      targetComputerIds.includes(computer.id) &&
      hasOverlap(
        bookings,
        {
          computerId: computer.id,
          date: editorState.draft.date,
          startMinutes: editorState.draft.startMinutes,
          endMinutes: editorState.draft.endMinutes,
          repeatWeekly: editorState.draft.repeatWeekly,
        },
        ignoreIds,
      ),
    );

    if (conflictingComputer) {
      return `Booking conflicts on ${conflictingComputer.name}.`;
    }

    return null;
  }, [bookings, editorState]);

  const shiftWeek = (offset: number) => {
    setWeekStart((currentWeekStart) => {
      const next = currentWeekStart || getInitialWeekStart();
      return formatDateKey(addDays(parseDateKey(next), offset * 7));
    });
  };

  const resetToCurrentWeek = () => {
    setWeekStart(getInitialWeekStart());
  };

  const toggleComputerFilter = (computerId: string) => {
    setFilteredComputerIds((current) => {
      const exists = current.includes(computerId);
      if (exists && current.length === 1) {
        return current;
      }
      return exists
        ? current.filter((id) => id !== computerId)
        : [...current, computerId];
    });
  };

  const openEditModal = (
    booking: Booking,
    options?: {
      bookingIds?: string[];
      computerIds?: string[];
      fullRoom?: boolean;
    },
  ) => {
    setEditorState({
      mode: "edit",
      bookingId: booking.id,
      bookingIds: options?.bookingIds ?? [booking.id],
      draft: {
        computerId: booking.computerId,
        bookingSeriesId: booking.bookingSeriesId,
        groupId: booking.groupId,
        title: booking.title,
        date: booking.date,
        startMinutes: booking.startMinutes,
        endMinutes: booking.endMinutes,
        repeatWeekly: booking.repeatWeekly,
        isFullRoom: options?.fullRoom ?? booking.isFullRoom,
      },
      selectedComputerIds: options?.computerIds ?? [booking.computerId],
      fullRoom: options?.fullRoom ?? booking.isFullRoom,
    });
  };

  const handleLanePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    date: string,
  ) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-booking-action='true']")) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const anchorMinutes = getScheduleMinutesFromPosition(
      event.clientY - rect.top,
      rect.height,
    );

    setDragState({
      kind: "create",
      date,
      laneTop: rect.top,
      laneHeight: rect.height,
      anchorMinutes,
      currentMinutes: anchorMinutes,
    });
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    booking: Booking,
    options: {
      bookingIds?: string[];
      fullRoom?: boolean;
    },
    edge: "start" | "end",
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const lane = event.currentTarget.closest(
      "[data-resize-surface='true']",
    ) as HTMLDivElement | null;

    if (!lane) {
      return;
    }

    const rect = lane.getBoundingClientRect();

    setDragState({
      kind: "resize",
      bookingId: booking.id,
      bookingIds: options.bookingIds ?? [booking.id],
      computerId: booking.computerId,
      date: booking.date,
      bookingSeriesId: booking.bookingSeriesId,
      isFullRoom: options.fullRoom ?? booking.isFullRoom,
      edge,
      laneTop: rect.top,
      laneHeight: rect.height,
      currentStart: booking.startMinutes,
      currentEnd: booking.endMinutes,
    });
  };

  const handleEditorChange = <K extends keyof BookingDraft>(
    field: K,
    value: BookingDraft[K],
  ) => {
    setEditorState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        draft:
          field === "startMinutes" || field === "endMinutes"
            ? ensureValidTimeRange(
                current.draft,
                field,
                Number(value),
              )
            : {
                ...current.draft,
                [field]: value,
              },
      };
    });
  };

  const toggleEditorComputer = (computerId: string) => {
    setEditorState((current) => {
      if (!current || current.mode !== "create") {
        return current;
      }

      const selectedComputerIds = new Set(current.selectedComputerIds ?? []);

      if (selectedComputerIds.has(computerId)) {
        selectedComputerIds.delete(computerId);
      } else {
        selectedComputerIds.add(computerId);
      }

      return {
        ...current,
        draft: {
          ...current.draft,
          computerId: [...selectedComputerIds][0] ?? current.draft.computerId,
        },
        selectedComputerIds: [...selectedComputerIds],
      };
    });
  };

  const setEditorFullRoom = (checked: boolean) => {
    setEditorState((current) => {
      if (!current || current.mode !== "create") {
        return current;
      }

      return {
        ...current,
        fullRoom: checked,
        draft: {
          ...current.draft,
          isFullRoom: checked,
        },
        selectedComputerIds: checked
          ? computers.map((computer) => computer.id)
          : current.selectedComputerIds ?? [],
      };
    });
  };

  const createBookings = async (drafts: BookingDraft[]) => {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookings: drafts }),
    });
    const body = await parseJsonResponse<{ bookings: Booking[] }>(response);
    setBookings((currentBookings) => [
      ...currentBookings,
      ...body.bookings.map(normalizeBooking),
    ]);
  };

  const updateBooking = async (ids: string[], booking: BookingDraft) => {
    const response = await fetch("/api/bookings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids, booking }),
    });
    const body = await parseJsonResponse<{
      bookings?: Booking[];
      booking?: Booking;
    }>(response);
    const updatedBookings = (body.bookings ?? (body.booking ? [body.booking] : []))
      .map(normalizeBooking);
    const updatedById = new Map(updatedBookings.map((entry) => [entry.id, entry]));
    setBookings((currentBookings) =>
      currentBookings.map((entry) => updatedById.get(entry.id) ?? entry),
    );
  };

  const removeBooking = async (ids: string[]) => {
    const response = await fetch("/api/bookings", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    await parseJsonResponse<{ ok: boolean }>(response);
    setBookings((currentBookings) =>
      currentBookings.filter((entry) => !ids.includes(entry.id)),
    );
  };

  const saveEditor = async () => {
    if (!editorState || editorError) {
      if (editorError) {
        setToast(editorError);
      }
      return;
    }

    const title = editorState.draft.title.trim();
    try {
      if (editorState.mode === "create") {
        const targetComputerIds = editorState.fullRoom
          ? computers.map((computer) => computer.id)
          : Array.from(new Set(editorState.selectedComputerIds ?? []));
        const bookingSeriesId = editorState.fullRoom ? crypto.randomUUID() : null;

        await createBookings(
          targetComputerIds.map((computerId) => ({
            ...editorState.draft,
            computerId,
            bookingSeriesId,
            title,
            isFullRoom: editorState.fullRoom ?? false,
          })),
        );
      } else if (editorState.bookingIds?.length) {
        await updateBooking(editorState.bookingIds, {
          ...editorState.draft,
          title,
        });
      }

      setActiveGroupId(editorState.draft.groupId);
      setEditorState(null);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Failed to save booking.",
      );
    }
  };

  const deleteBooking = async (bookingIds: string[]) => {
    try {
      await removeBooking(bookingIds);
      setEditorState(null);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Failed to delete booking.",
      );
    }
  };

  const handleCheckIn = async () => {
    if (!normalizedTrackingUserId) {
      setToast("Enter a user ID before checking in.");
      return;
    }

    if (activeSessionForUser) {
      setToast("That user is already checked in.");
      return;
    }

    try {
      const response = await fetch("/api/time-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "check-in",
          userId: normalizedTrackingUserId,
        }),
      });
      const body = await parseJsonResponse<{ session: TimeSession }>(response);
      setTimeSessions((currentSessions) => [body.session, ...currentSessions]);
      setCheckoutNote("");
      setToast(`Checked in ${normalizedTrackingUserId}.`);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Failed to check in.",
      );
    }
  };

  const handleCheckOut = async () => {
    if (!activeSessionForUser) {
      setToast("No active session found for that user ID.");
      return;
    }

    try {
      const response = await fetch("/api/time-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "check-out",
          userId: activeSessionForUser.userId,
          note: checkoutNote.trim(),
        }),
      });
      const body = await parseJsonResponse<{ session: TimeSession }>(response);
      setTimeSessions((currentSessions) =>
        currentSessions.map((session) =>
          session.id === body.session.id ? body.session : session,
        ),
      );
      setCheckoutNote("");
      setToast(`Checked out ${activeSessionForUser.userId}.`);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Failed to check out.",
      );
    }
  };

  if (!weekStart || isDataLoading) {
    return (
      <main className="min-h-screen bg-[var(--page-background)] px-6 py-8 text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl animate-pulse rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="h-8 w-72 rounded-full bg-slate-200" />
          <div className="mt-4 h-4 w-40 rounded-full bg-slate-200" />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-28 rounded-[1.5rem] bg-slate-100"
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="scheduler-shell min-h-screen px-4 py-4 text-[var(--foreground)] md:px-6 md:py-6">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
        <section className="overflow-hidden rounded-[1.4rem] border border-white/60 bg-white/76 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Booking board
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950 md:text-2xl">
                Weekly computer schedule
              </h1>
              <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-600">
                Drag to book. Full-room bookings span all computer columns.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[460px]">
              <article className="rounded-[1rem] border border-slate-200/70 bg-[linear-gradient(160deg,rgba(235,94,40,0.15),rgba(255,255,255,0.88))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Total booked
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {formatHours(weekSummary.totalMinutes)}
                </p>
              </article>
              {groups.map((group) => {
                const groupTotals = getWeekSummaryCard(
                  weekSummary,
                  computers[0].id,
                  group.id,
                );

                return (
                  <article
                    key={group.id}
                    className="rounded-[1rem] border border-slate-200/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
                    style={{
                      background: `linear-gradient(160deg, ${group.surfaceColor}, rgba(255,255,255,0.92))`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                        {group.name}
                      </p>
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {formatHours(groupTotals.groupMinutes)}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/80 pt-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={resetToCurrentWeek}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => setTrackingModalOpen(true)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
              >
                {activeSessions.length > 0 ? "Check in/out • active" : "Check in/out"}
              </button>
            </div>

            <div className="flex flex-col items-start gap-2 lg:items-end">
              <div className="rounded-full border border-slate-200 bg-slate-950 px-3 py-1.5 text-[11px] font-medium text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
                {formatWeekRange(weekStart)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                {groups.map((group) => (
                  <span key={group.id} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.4rem] border border-white/60 bg-white/82 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="border-b border-slate-200/80 px-4 py-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">Weekly planner</p>
              </div>
              <p className="max-w-2xl text-[11px] leading-5 text-slate-500">
                08:00-17:00 planned schedule. After hours are first come, first served.
              </p>
            </div>
          </div>

          <div className="px-2 py-3 md:px-3">
            <div className="flex flex-col gap-2 px-1 pb-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Filter computers
                </span>
                {computers.map((computer) => {
                  const selected = filteredComputerIds.includes(computer.id);
                  return (
                    <button
                      key={computer.id}
                      type="button"
                      onClick={() => toggleComputerFilter(computer.id)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-950 hover:text-slate-950"}`}
                    >
                      {computer.name}
                    </button>
                  );
                })}
              </div>
              <p className="max-w-2xl text-[11px] leading-5 text-slate-500">
                Schedule view covers 08:00 to 17:00. After hours are first
                come, first served.
              </p>
            </div>

            <div className="grid gap-2 px-1 xl:grid-cols-7">
              {weekDays.map((day) => {
                const activeCreateBooking =
                  dragState?.kind === "create" && dragState.date === day
                    ? {
                        startMinutes: Math.min(
                          dragState.anchorMinutes,
                          dragState.currentMinutes,
                        ),
                        endMinutes: Math.max(
                          dragState.anchorMinutes,
                          dragState.currentMinutes,
                        ),
                        groupId: activeGroupId,
                      }
                    : null;

                const dayTotal = presenceMinutesByDay.get(day) ?? 0;
                const fullRoomBookings = fullRoomBookingsByDay.get(day) ?? [];

                return (
                  <section
                    key={day}
                    className="min-w-0 rounded-[1rem] border border-slate-200/80 bg-white/88 p-1.5 shadow-[0_12px_24px_rgba(15,23,42,0.07)]"
                  >
                    <div className="flex items-end justify-between gap-2 border-b border-slate-200/80 px-1 pb-1.5">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-950">
                          {formatDayLabel(day)}
                        </p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-slate-500">
                          {formatHours(dayTotal)} booked
                        </p>
                      </div>
                      <p className="text-[8px] uppercase tracking-[0.16em] text-slate-400">
                        {visibleComputers.length} shown
                      </p>
                    </div>

                    <div className="relative mt-2">
                      <div
                        className="grid gap-1"
                        style={{
                          gridTemplateColumns: `repeat(${visibleComputers.length}, minmax(0, 1fr))`,
                        }}
                      >
                        {visibleComputers.map((computer) => {
                          const laneKey = `${computer.id}:${day}`;
                          const laneMinutes = bookingMinutesByLane.get(laneKey) ?? 0;
                          const computerSurface = getComputerSurface(computer.id);

                          return (
                            <div
                              key={`${laneKey}:header`}
                              className="rounded-[0.7rem] border px-1 py-1 text-center"
                              style={{
                                borderColor: computerSurface.border,
                                background: computerSurface.background,
                              }}
                            >
                              <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-900">
                                {getComputerLabel(computer.name)}
                              </p>
                              <p className="mt-0.5 text-[7px] uppercase tracking-[0.08em] text-slate-500">
                                {formatHours(laneMinutes)}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        className="mt-1 grid gap-1"
                        style={{
                          gridTemplateColumns: `repeat(${visibleComputers.length}, minmax(0, 1fr))`,
                        }}
                      >
                        {visibleComputers.map((computer) => {
                          const laneKey = `${computer.id}:${day}`;
                          const laneBookings = bookingsByLane.get(laneKey) ?? [];
                          const computerSurface = getComputerSurface(computer.id);

                          return (
                            <div key={laneKey}>
                              <div
                                data-lane="true"
                                data-resize-surface="true"
                                onPointerDown={(event) =>
                                  handleLanePointerDown(event, day)
                                }
                                className="scheduler-lane relative overflow-hidden rounded-[0.85rem] border shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] select-none"
                                style={{
                                  height: `${LANE_HEIGHT}px`,
                                  borderColor: computerSurface.border,
                                  background: computerSurface.background,
                                }}
                              >
                                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.52),transparent_28%,transparent_72%,rgba(15,23,42,0.03))]" />
                                {VISIBLE_HOUR_MARKERS.map((hour) => (
                                  <span
                                    key={hour}
                                    className="pointer-events-none absolute left-1 z-[6] rounded-full bg-white/95 px-1 py-0.5 text-[7px] font-semibold uppercase tracking-[0.1em] text-slate-500 shadow-sm"
                                    style={{
                                      top:
                                        hour === SCHEDULE_START_MINUTES / 60
                                          ? "0.35rem"
                                          : `${((hour * 60 - SCHEDULE_START_MINUTES) / (SCHEDULE_END_MINUTES - SCHEDULE_START_MINUTES)) * 100}%`,
                                      transform:
                                        hour === SCHEDULE_START_MINUTES / 60
                                          ? "none"
                                          : "translateY(-50%)",
                                    }}
                                  >
                                    {minutesToTime(hour * 60)}
                                  </span>
                                ))}
                                <span className="pointer-events-none absolute bottom-1 left-1 z-[6] rounded-full bg-white/95 px-1 py-0.5 text-[7px] font-semibold uppercase tracking-[0.1em] text-slate-500 shadow-sm">
                                  17:00
                                </span>

                                {laneBookings.map((booking) => {
                                  const isResizing =
                                    dragState?.kind === "resize" &&
                                    dragState.bookingId === booking.id;
                                  const renderedBooking = isResizing
                                    ? {
                                        ...booking,
                                        startMinutes: dragState.currentStart,
                                        endMinutes: dragState.currentEnd,
                                      }
                                    : booking;
                                  const group = getGroup(renderedBooking.groupId);
                                  const isCompact =
                                    renderedBooking.endMinutes -
                                      renderedBooking.startMinutes <
                                    60;

                                  return (
                                    <div
                                      key={booking.id}
                                      data-booking-action="true"
                                      onClick={() => openEditModal(booking)}
                                      className="absolute left-0.5 right-0.5 z-[2] cursor-pointer rounded-[0.6rem] border px-1 pb-1 pt-2 shadow-[0_8px_16px_rgba(15,23,42,0.12)] transition hover:translate-y-[-1px] hover:shadow-[0_10px_20px_rgba(15,23,42,0.16)]"
                                      style={{
                                        ...getBlockStyle(
                                          renderedBooking.startMinutes,
                                          renderedBooking.endMinutes,
                                        ),
                                        borderColor: group.color,
                                        background: `linear-gradient(180deg, ${group.surfaceColor}, rgba(255,255,255,0.94))`,
                                      }}
                                    >
                                      <button
                                        type="button"
                                        aria-label="Resize start"
                                        data-booking-action="true"
                                        onPointerDown={(event) =>
                                          handleResizePointerDown(
                                            event,
                                            booking,
                                            {
                                              bookingIds: [booking.id],
                                              fullRoom: false,
                                            },
                                            "start",
                                          )
                                        }
                                        className="absolute inset-x-0 top-0 h-2.5 cursor-row-resize rounded-t-[0.6rem]"
                                      />
                                      <button
                                        type="button"
                                        aria-label="Resize end"
                                        data-booking-action="true"
                                        onPointerDown={(event) =>
                                          handleResizePointerDown(
                                            event,
                                            booking,
                                            {
                                              bookingIds: [booking.id],
                                              fullRoom: false,
                                            },
                                            "end",
                                          )
                                        }
                                        className="absolute inset-x-0 bottom-0 h-2.5 cursor-row-resize rounded-b-[0.6rem]"
                                      />

                                      <div className="flex items-start justify-between gap-1.5">
                                        <div className="min-w-0">
                                          <p
                                            className={`break-words font-semibold leading-tight tracking-[-0.02em] text-slate-950 ${isCompact ? "text-[7px]" : "text-[8px]"}`}
                                          >
                                            {renderedBooking.title}
                                          </p>
                                        </div>
                                        <span
                                          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                                          style={{ backgroundColor: group.color }}
                                        />
                                      </div>

                                      <p
                                        className={`mt-0.5 font-medium text-slate-700 ${isCompact ? "text-[7px]" : "text-[8px]"}`}
                                      >
                                        {minutesToTime(renderedBooking.startMinutes)} -{" "}
                                        {minutesToTime(renderedBooking.endMinutes)}
                                      </p>
                                    </div>
                                  );
                                })}

                                {activeCreateBooking &&
                                activeCreateBooking.endMinutes -
                                  activeCreateBooking.startMinutes >=
                                  MIN_BOOKING_MINUTES ? (
                                  <div
                                    className="absolute left-0.5 right-0.5 z-[1] rounded-[0.75rem] border border-dashed opacity-80"
                                    style={{
                                      ...getBlockStyle(
                                        activeCreateBooking.startMinutes,
                                        activeCreateBooking.endMinutes,
                                      ),
                                      borderColor: getGroup(
                                        activeCreateBooking.groupId,
                                      ).color,
                                      background: getGroup(
                                        activeCreateBooking.groupId,
                                      ).surfaceColor,
                                    }}
                                  />
                                ) : null}

                                {laneBookings.length === 0 && !activeCreateBooking ? (
                                  <div className="pointer-events-none absolute inset-x-0.5 bottom-1.5 rounded-full border border-dashed border-slate-200 bg-white/70 px-1 py-0.5 text-center text-[7px] font-medium uppercase tracking-[0.1em] text-slate-400">
                                    Drag
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {fullRoomBookings.length > 0 ? (
                        <div
                          data-resize-surface="true"
                          className="pointer-events-none absolute inset-x-0 bottom-0 top-[2.15rem] z-[4]"
                        >
                          {fullRoomBookings.map((displayBooking) => {
                            const isResizing =
                              dragState?.kind === "resize" &&
                              displayBooking.bookingIds.includes(dragState.bookingId);
                            const renderedBooking = isResizing
                              ? {
                                  ...displayBooking.booking,
                                  startMinutes: dragState.currentStart,
                                  endMinutes: dragState.currentEnd,
                                }
                              : displayBooking.booking;
                            const group = getGroup(renderedBooking.groupId);
                            const isCompact =
                              renderedBooking.endMinutes -
                                renderedBooking.startMinutes <
                              60;

                            return (
                              <div
                                key={displayBooking.key}
                                className="absolute inset-x-0"
                                style={getBlockStyle(
                                  renderedBooking.startMinutes,
                                  renderedBooking.endMinutes,
                                )}
                              >
                                <div
                                  className="grid h-full gap-1"
                                  style={{
                                    gridTemplateColumns: `repeat(${visibleComputers.length}, minmax(0, 1fr))`,
                                  }}
                                >
                                  <div
                                    data-booking-action="true"
                                    onClick={() =>
                                      openEditModal(displayBooking.booking, {
                                        bookingIds: displayBooking.bookingIds,
                                        computerIds: displayBooking.computerIds,
                                        fullRoom: true,
                                      })
                                    }
                                    className="pointer-events-auto relative cursor-pointer rounded-[0.7rem] border px-1.5 pb-1 pt-2 shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition hover:translate-y-[-1px]"
                                    style={{
                                      gridColumn: `${displayBooking.startColumn + 1} / ${displayBooking.endColumn + 2}`,
                                      borderColor: group.color,
                                      background: `linear-gradient(180deg, ${group.surfaceColor}, rgba(255,255,255,0.98))`,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      aria-label="Resize start"
                                      data-booking-action="true"
                                      onPointerDown={(event) =>
                                        handleResizePointerDown(
                                          event,
                                          displayBooking.booking,
                                          {
                                            bookingIds: displayBooking.bookingIds,
                                            fullRoom: true,
                                          },
                                          "start",
                                        )
                                      }
                                      className="absolute inset-x-0 top-0 h-2.5 cursor-row-resize rounded-t-[0.7rem]"
                                    />
                                    <button
                                      type="button"
                                      aria-label="Resize end"
                                      data-booking-action="true"
                                      onPointerDown={(event) =>
                                        handleResizePointerDown(
                                          event,
                                          displayBooking.booking,
                                          {
                                            bookingIds: displayBooking.bookingIds,
                                            fullRoom: true,
                                          },
                                          "end",
                                        )
                                      }
                                      className="absolute inset-x-0 bottom-0 h-2.5 cursor-row-resize rounded-b-[0.7rem]"
                                    />
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p
                                          className={`break-words font-semibold leading-tight text-slate-950 ${isCompact ? "text-[8px]" : "text-[9px]"}`}
                                        >
                                          {renderedBooking.title}
                                        </p>
                                        <p className="mt-0.5 text-[7px] font-medium uppercase tracking-[0.12em] text-slate-600">
                                          Full room
                                        </p>
                                      </div>
                                      <span
                                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: group.color }}
                                      />
                                    </div>
                                    <p className="mt-0.5 text-[8px] font-medium text-slate-700">
                                      {minutesToTime(renderedBooking.startMinutes)} -{" "}
                                      {minutesToTime(renderedBooking.endMinutes)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-full border border-slate-200 bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_40px_rgba(15,23,42,0.28)]">
          {toast}
        </div>
      ) : null}

      {trackingModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[1.4rem] border border-white/70 bg-white p-4 shadow-[0_40px_120px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Time tracking
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                  Check in and check out
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Enter a user ID. New IDs are created automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTrackingModalOpen(false)}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    User ID
                  </span>
                  <input
                    type="text"
                    value={trackingUserId}
                    onChange={(event) => setTrackingUserId(event.target.value)}
                    placeholder="example: user-1024"
                    className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                  />
                </label>
                <div className="flex items-end">
                  {activeSessionForUser ? (
                    <button
                      type="button"
                      onClick={handleCheckOut}
                      className="w-full rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_24px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] hover:shadow-[0_16px_30px_rgba(15,23,42,0.28)]"
                    >
                      Check out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckIn}
                      className="w-full rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_24px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] hover:shadow-[0_16px_30px_rgba(15,23,42,0.28)]"
                    >
                      Check in
                    </button>
                  )}
                </div>
              </div>

              {activeSessionForUser ? (
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Active session
                      </p>
                      <p className="mt-1 text-base font-semibold text-slate-950">
                        {activeSessionForUser.userId}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-slate-950">
                      {formatHoursAndMinutes(
                        sessionDurationMinutes(activeSessionForUser, now),
                      )}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Checked in {new Date(activeSessionForUser.checkInAt).toLocaleString("en-GB")}
                  </p>
                  <label className="mt-4 grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Checkout note
                    </span>
                    <textarea
                      value={checkoutNote}
                      onChange={(event) => setCheckoutNote(event.target.value)}
                      rows={3}
                      placeholder="Short description of what you did"
                      className="rounded-[1rem] border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-slate-950"
                    />
                  </label>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    User totals
                  </p>
                  <div className="mt-3 grid gap-2">
                    {timeTotalsByUser.length === 0 ? (
                      <p className="text-sm text-slate-500">No tracked time yet.</p>
                    ) : (
                      timeTotalsByUser.slice(0, 6).map((entry) => (
                        <div
                          key={entry.userId}
                          className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-slate-200 bg-white px-3 py-2.5"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-950">
                              {entry.userId}
                            </p>
                            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                              {entry.sessionCount} session{entry.sessionCount === 1 ? "" : "s"}
                              {entry.active ? " active" : ""}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-slate-950">
                            {formatHoursAndMinutes(entry.totalMinutes)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Recent activity
                  </p>
                  <div className="mt-3 grid gap-2">
                    {recentSessions.length === 0 ? (
                      <p className="text-sm text-slate-500">No time entries saved yet.</p>
                    ) : (
                      recentSessions.map((session) => (
                        <div
                          key={session.id}
                          className="rounded-[0.9rem] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-slate-950">
                              {session.userId}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                              {session.checkOutAt ? "Completed" : "Checked in"}
                            </p>
                          </div>
                          <p className="mt-2">
                            {new Date(session.checkInAt).toLocaleString("en-GB")} -{" "}
                            {session.checkOutAt
                              ? new Date(session.checkOutAt).toLocaleString("en-GB")
                              : "Active"}
                          </p>
                          <p className="mt-1">
                            {formatHoursAndMinutes(sessionDurationMinutes(session, now))}
                          </p>
                          {session.note ? (
                            <p className="mt-2 rounded-lg bg-slate-50 px-2 py-2 text-xs text-slate-600">
                              {session.note}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editorState ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-[1.4rem] border border-white/70 bg-white p-4 shadow-[0_40px_120px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  {editorState.mode === "create"
                    ? "Create booking"
                    : "Edit booking"}
                </p>
                <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">
                  {editorState.mode === "create"
                    ? "Choose computers"
                    : editorState.fullRoom
                      ? "Full room"
                      : (computers.find(
                          (computer) =>
                            computer.id === editorState.draft.computerId,
                        )?.name ?? "Computer")}
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  {formatDayLabel(editorState.draft.date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditorState(null)}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-950 hover:text-slate-950"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Booking name
                </span>
                <input
                  type="text"
                  value={editorState.draft.title}
                  onChange={(event) =>
                    handleEditorChange("title", event.target.value)
                  }
                  placeholder="Example: Fabrication session"
                  className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                />
              </label>

              <div
                className={`grid gap-4 ${editorState.mode === "create" ? "md:grid-cols-4" : "md:grid-cols-3"}`}
              >
                {editorState.mode === "create" ? (
                  <label className="grid gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Day
                    </span>
                    <select
                      value={editorState.draft.date}
                      onChange={(event) =>
                        handleEditorChange("date", event.target.value)
                      }
                      className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                    >
                      {weekDays.map((day) => (
                        <option key={day} value={day}>
                          {formatDayLabel(day)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Group
                  </span>
                  <select
                    value={editorState.draft.groupId}
                    onChange={(event) =>
                      handleEditorChange("groupId", event.target.value)
                    }
                    className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Start
                  </span>
                  <select
                    value={String(editorState.draft.startMinutes)}
                    onChange={(event) =>
                      handleEditorChange(
                        "startMinutes",
                        Number(event.target.value),
                      )
                    }
                    className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                  >
                    {TIME_OPTIONS.filter(
                      (minutes) =>
                        minutes <= editorState.draft.endMinutes - MIN_BOOKING_MINUTES,
                    ).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutesToTime(minutes)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    End
                  </span>
                  <select
                    value={String(editorState.draft.endMinutes)}
                    onChange={(event) =>
                      handleEditorChange(
                        "endMinutes",
                        Number(event.target.value),
                      )
                    }
                    className="rounded-[1rem] border border-slate-300 bg-slate-50 px-3 py-2.5 text-base text-slate-950 outline-none transition focus:border-slate-950"
                  >
                    {TIME_OPTIONS.filter(
                      (minutes) =>
                        minutes >= editorState.draft.startMinutes + MIN_BOOKING_MINUTES,
                    ).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutesToTime(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {editorState.mode === "create" ? (
                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Computers
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Pick one or more computers, or book the full room.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={editorState.fullRoom ?? false}
                        onChange={(event) =>
                          setEditorFullRoom(event.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Full room
                    </label>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {computers.map((computer) => {
                      const checked = (editorState.fullRoom ?? false)
                        ? true
                        : (editorState.selectedComputerIds ?? []).includes(
                            computer.id,
                          );

                      return (
                        <label
                          key={computer.id}
                          className={`flex items-center justify-between gap-3 rounded-[0.9rem] border px-3 py-2.5 text-sm transition ${(editorState.fullRoom ?? false) || checked ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                        >
                          <span>{computer.name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={editorState.fullRoom ?? false}
                            onChange={() => toggleEditorComputer(computer.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

                <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Repeat
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Reuse this booking every week on the same weekday.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editorState.draft.repeatWeekly}
                      onChange={(event) =>
                        handleEditorChange("repeatWeekly", event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Repeats weekly
                  </label>
                </div>
              </div>

              <div className="rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-slate-950">
                    Duration:{" "}
                    {formatHours(
                      Math.max(
                        0,
                        editorState.draft.endMinutes -
                          editorState.draft.startMinutes,
                      ),
                    )}
                  </span>
                  <span className="text-slate-400">|</span>
                  <span>{minutesToTime(editorState.draft.startMinutes)}</span>
                  <span className="text-slate-400">to</span>
                  <span>{minutesToTime(editorState.draft.endMinutes)}</span>
                </div>
                {editorError ? (
                  <p className="mt-3 font-medium text-[var(--danger)]">
                    {editorError}
                  </p>
                ) : (
                  <p className="mt-3">
                    {editorState.mode === "create"
                      ? "The same time range can be applied to any checked computers."
                      : "Clicking a block opens its details here. Scheduling is limited to 08:00-17:00."}
                  </p>
                )}
              </div>

              <div className="rounded-[1rem] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Booking details
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <p>
                    <span className="font-medium text-slate-950">Date:</span>{" "}
                    {formatDayLabel(editorState.draft.date)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-950">Time:</span>{" "}
                    {minutesToTime(editorState.draft.startMinutes)} -{" "}
                    {minutesToTime(editorState.draft.endMinutes)}
                  </p>
                  <p>
                    <span className="font-medium text-slate-950">Group:</span>{" "}
                    {getGroup(editorState.draft.groupId).name}
                  </p>
                  <p>
                    <span className="font-medium text-slate-950">Repeat:</span>{" "}
                    {editorState.draft.repeatWeekly ? "Every week" : "One time"}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="font-medium text-slate-950">Computers:</span>{" "}
                    {editorState.mode === "create"
                      ? editorState.fullRoom
                        ? "Full room"
                        : (editorState.selectedComputerIds ?? []).length > 0
                          ? (editorState.selectedComputerIds ?? [])
                              .map(
                                (computerId) =>
                                  computers.find(
                                    (computer) => computer.id === computerId,
                                  )?.name ?? computerId,
                              )
                              .join(", ")
                          : "None selected"
                      : editorState.fullRoom
                        ? "Full room"
                        : computers.find(
                            (computer) =>
                              computer.id === editorState.draft.computerId,
                          )?.name}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editorState.mode === "edit" && editorState.bookingIds?.length ? (
                  <button
                    type="button"
                    onClick={() => deleteBooking(editorState.bookingIds!)}
                    className="rounded-full border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-1.5 text-sm font-medium text-[var(--danger)] transition hover:border-[var(--danger)]/45"
                  >
                    Delete booking
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditorState(null)}
                  className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-950 hover:text-slate-950"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEditor}
                  className="rounded-full bg-slate-950 px-5 py-1.5 text-sm font-medium text-white shadow-[0_12px_24px_rgba(15,23,42,0.25)] transition hover:translate-y-[-1px] hover:shadow-[0_16px_30px_rgba(15,23,42,0.28)]"
                >
                  {editorState.mode === "create"
                    ? "Save booking"
                    : "Update booking"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
