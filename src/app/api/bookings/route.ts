import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  SCHEDULE_END_MINUTES,
  SCHEDULE_START_MINUTES,
  hasOverlap,
} from "@/lib/scheduler";

type BookingPayload = {
  computerId: string;
  groupId: string;
  title: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  repeatWeekly: boolean;
};

type OverlapBooking = Pick<
  BookingPayload,
  "computerId" | "date" | "startMinutes" | "endMinutes" | "repeatWeekly"
> & {
  id: string;
};

function isBookingPayload(value: unknown): value is BookingPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const booking = value as Record<string, unknown>;
  return (
    typeof booking.computerId === "string" &&
    typeof booking.groupId === "string" &&
    typeof booking.title === "string" &&
    typeof booking.date === "string" &&
    typeof booking.startMinutes === "number" &&
    typeof booking.endMinutes === "number" &&
    typeof booking.repeatWeekly === "boolean"
  );
}

function isValidBookingPayload(booking: BookingPayload) {
  return (
    booking.title.trim().length > 0 &&
    booking.startMinutes >= SCHEDULE_START_MINUTES &&
    booking.endMinutes <= SCHEDULE_END_MINUTES &&
    booking.endMinutes > booking.startMinutes
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error.";
}

export async function GET() {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
    });

    return NextResponse.json({ bookings });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { bookings?: unknown };
    const bookings = Array.isArray(body.bookings) ? body.bookings : [];

    if (
      bookings.length === 0 ||
      !bookings.every((booking) => isBookingPayload(booking) && isValidBookingPayload(booking))
    ) {
      return NextResponse.json(
        { error: "Invalid booking payload." },
        { status: 400 },
      );
    }

    const existingBookings = (await prisma.booking.findMany()).map(
      (booking): OverlapBooking => ({
        id: booking.id,
        computerId: booking.computerId,
        date: booking.date,
        startMinutes: booking.startMinutes,
        endMinutes: booking.endMinutes,
        repeatWeekly: booking.repeatWeekly,
      }),
    );
    const pendingBookings: OverlapBooking[] = [...existingBookings];

    for (const booking of bookings) {
      if (hasOverlap(pendingBookings, booking)) {
        return NextResponse.json(
          { error: "One or more bookings overlap an existing booking." },
          { status: 409 },
        );
      }
      pendingBookings.push({
        id: crypto.randomUUID(),
        computerId: booking.computerId,
        date: booking.date,
        startMinutes: booking.startMinutes,
        endMinutes: booking.endMinutes,
        repeatWeekly: booking.repeatWeekly,
      });
    }

    const timestamp = new Date();
    const created = await prisma.$transaction(
      bookings.map((booking) =>
        prisma.booking.create({
          data: {
            id: crypto.randomUUID(),
            ...booking,
            title: booking.title.trim(),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        }),
      ),
    );

    return NextResponse.json({ bookings: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      booking?: unknown;
    };

    if (typeof body.id !== "string" || !isBookingPayload(body.booking)) {
      return NextResponse.json(
        { error: "Invalid update payload." },
        { status: 400 },
      );
    }

    if (!isValidBookingPayload(body.booking)) {
      return NextResponse.json(
        { error: "Booking must be between 08:00 and 17:00." },
        { status: 400 },
      );
    }

    const existingBookings = (await prisma.booking.findMany()).map(
      (booking): OverlapBooking => ({
        id: booking.id,
        computerId: booking.computerId,
        date: booking.date,
        startMinutes: booking.startMinutes,
        endMinutes: booking.endMinutes,
        repeatWeekly: booking.repeatWeekly,
      }),
    );
    if (hasOverlap(existingBookings, body.booking, body.id)) {
      return NextResponse.json(
        { error: "Booking overlaps an existing booking." },
        { status: 409 },
      );
    }

    const booking = await prisma.booking.update({
      where: { id: body.id },
      data: {
        ...body.booking,
        title: body.booking.title.trim(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ booking });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown };

    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "Missing booking ID." }, { status: 400 });
    }

    await prisma.booking.delete({
      where: { id: body.id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
