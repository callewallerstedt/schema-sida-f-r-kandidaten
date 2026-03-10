import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type CheckInBody = {
  action: "check-in";
  userId: string;
};

type CheckOutBody = {
  action: "check-out";
  userId: string;
  note?: string;
};

export async function GET() {
  const sessions = await prisma.timeSession.findMany({
    orderBy: [{ checkInAt: "desc" }],
  });

  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CheckInBody | CheckOutBody;

  if (body.action === "check-in") {
    const userId = body.userId?.trim();
    if (!userId) {
      return NextResponse.json({ error: "Missing user ID." }, { status: 400 });
    }

    const existing = await prisma.timeSession.findFirst({
      where: {
        userId: { equals: userId, mode: "insensitive" },
        checkOutAt: null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "User is already checked in." },
        { status: 409 },
      );
    }

    const now = new Date();
    const session = await prisma.timeSession.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        computerId: null,
        checkInAt: now,
        checkOutAt: null,
        note: "",
        createdAt: now,
        updatedAt: now,
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  }

  if (body.action === "check-out") {
    const userId = body.userId?.trim();
    if (!userId) {
      return NextResponse.json({ error: "Missing user ID." }, { status: 400 });
    }

    const existing = await prisma.timeSession.findFirst({
      where: {
        userId: { equals: userId, mode: "insensitive" },
        checkOutAt: null,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "No active session found." },
        { status: 404 },
      );
    }

    const session = await prisma.timeSession.update({
      where: { id: existing.id },
      data: {
        checkOutAt: new Date(),
        note: body.note?.trim() ?? "",
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ session });
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
